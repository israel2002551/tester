import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webPush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function handleOptions(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

function json(body: Record<string, unknown> | any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(error: any) {
  console.error("Function error:", error);
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, message.includes("Unauthorized") ? 401 : 500);
}

type PushTarget = {
  user_id: string;
  endpoint?: string;
  subscription: any;
};

const siteUrl = Deno.env.get("SITE_URL") ?? "https://buysell-markerplace.com";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "BHy42JVEzqL40I-Mhvu9dRK8Ewov4GSFKy5IIcsOKgerR-Z8DE_9WNc1N1GPShB0XF3fnjOwz2XpNtf4fdoOn50";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@buysell-markerplace.com";

function money(value: unknown) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function parsePushSubscription(token: unknown) {
  if (!token) return null;
  if (typeof token === "object") return token;
  if (typeof token !== "string") return null;
  try {
    return JSON.parse(token);
  } catch {
    return null;
  }
}

function authCron(req: Request) {
  const expected = Deno.env.get("PRODUCT_DIGEST_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
  if (!expected) return;
  if ((req.headers.get("x-cron-secret") ?? "") !== expected) {
    throw new Error("Unauthorized digest request.");
  }
}

async function sendPushNotification(subscription: any, payload: Record<string, unknown>) {
  if (!vapidPrivateKey) throw new Error("VAPID_PRIVATE_KEY is not configured.");
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return await webPush.sendNotification(subscription, JSON.stringify(payload));
}

async function getPushTargets(admin: ReturnType<typeof createClient>) {
  const targets: PushTarget[] = [];
  const seen = new Set<string>();

  const { data: rows, error: tableError } = await admin
    .from("push_subscriptions")
    .select("id,user_id,subscription");

  if (!tableError && rows?.length) {
    for (const row of rows) {
      const subscription = parsePushSubscription(row.subscription);
      const endpoint = subscription?.endpoint;
      if (subscription && endpoint && !seen.has(endpoint)) {
        seen.add(endpoint);
        targets.push({ user_id: row.user_id, endpoint, subscription });
      }
    }
  } else if (tableError) {
    console.warn("push_subscriptions lookup failed:", tableError.message);
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id,push_subscription_token");

  if (profileError) throw profileError;

  for (const profile of profiles || []) {
    const subscription = parsePushSubscription(profile.push_subscription_token);
    const endpoint = subscription?.endpoint;
    if (subscription && endpoint && !seen.has(endpoint)) {
      seen.add(endpoint);
      targets.push({ user_id: profile.id, endpoint, subscription });
    }
  }

  return targets;
}

serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    authCron(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: products, error: productError, count } = await admin
      .from("products")
      .select("id,name,price,image_url,category,created_at", { count: "exact" })
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(6);

    if (productError) throw productError;
    if (!products?.length) return json({ message: "No active products available for digest." });

    const productCount = count ?? products.length;
    const first = products[0];
    const names = products.slice(0, 3).map((product) => product.name || "New item").join(", ");
    const payload = {
      source: "buysell-web-push",
      title: `${productCount} products available on BUYSELL`,
      body: `${names}${productCount > 3 ? " and more" : ""}. Latest from ${money(first.price)}.`,
      icon: first.image_url || `${siteUrl}/favicon.ico`,
      image: first.image_url || undefined,
      url: siteUrl,
      tag: "product-digest",
    };

    const targets = await getPushTargets(admin);
    if (targets.length === 0) return json({ message: "No push subscriptions found to notify." });

    const results: any[] = [];
    const failures: any[] = [];

    for (const target of targets) {
      try {
        await sendPushNotification(target.subscription, payload);
        results.push({ user_id: target.user_id });
      } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 0);
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ user_id: target.user_id, error: message });

        if (statusCode === 404 || statusCode === 410) {
          if (target.endpoint) {
            await admin.from("push_subscriptions").delete().eq("endpoint", target.endpoint);
          }
          await admin.from("profiles").update({ push_subscription_token: null }).eq("id", target.user_id);
        }
      }
    }

    return json({
      success: true,
      products: productCount,
      targets: targets.length,
      sent: results.length,
      failed: failures.length,
    });
  } catch (error) {
    return fail(error);
  }
});
