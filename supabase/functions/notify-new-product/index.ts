import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webPush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function handleOptions(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
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
  return json({ error: error instanceof Error ? error.message : String(error) }, 500);
}

const siteUrl = Deno.env.get("SITE_URL") ?? "https://buysell-markerplace.com";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "BHy42JVEzqL40I-Mhvu9dRK8Ewov4GSFKy5IIcsOKgerR-Z8DE_9WNc1N1GPShB0XF3fnjOwz2XpNtf4fdoOn50";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@buysell-markerplace.com";

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

type ProfileTarget = {
  id: string;
  push_subscription_token?: unknown;
};

type PushTarget = {
  user_id: string;
  endpoint?: string;
  subscription: any;
};

async function getPushTargetsForProfiles(admin: ReturnType<typeof createClient>, profiles: ProfileTarget[]) {
  const targets: PushTarget[] = [];
  const seen = new Set<string>();
  const userIds = profiles.map((profile) => profile.id).filter(Boolean);

  if (userIds.length) {
    const { data: rows, error: tableError } = await admin
      .from("push_subscriptions")
      .select("user_id,endpoint,subscription")
      .in("user_id", userIds);

    if (!tableError) {
      for (const row of rows || []) {
        const subscription = parsePushSubscription(row.subscription);
        const endpoint = row.endpoint || subscription?.endpoint;
        if (subscription && endpoint && !seen.has(endpoint)) {
          seen.add(endpoint);
          targets.push({ user_id: row.user_id, endpoint, subscription });
        }
      }
    } else {
      console.warn("push_subscriptions lookup failed:", tableError.message);
    }
  }

  for (const profile of profiles) {
    const subscription = parsePushSubscription(profile.push_subscription_token);
    const endpoint = subscription?.endpoint;
    if (subscription && endpoint && !seen.has(endpoint)) {
      seen.add(endpoint);
      targets.push({ user_id: profile.id, endpoint, subscription });
    }
  }

  return targets;
}

async function sendPushNotification(subscription: any, payload: Record<string, unknown>) {
  if (!vapidPrivateKey) {
    throw new Error("VAPID_PRIVATE_KEY is not configured.");
  }

  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return await webPush.sendNotification(subscription, JSON.stringify(payload));
}

serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const payload = await req.json();
    const { type, record, old_record } = payload;

    if (record?.status !== "active") {
      return json({ message: "Product is not active. Skipping notification." });
    }

    if (type === "UPDATE" && old_record?.status === "active") {
      return json({ message: "Product status was already active. Skipping notification." });
    }

    const { id, name, price, image_url, description } = record;

    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id,name,role,accounts,push_subscription_token");

    if (profileError) throw profileError;

    const buyers = (profiles || []).filter((profile) => {
      const role = String(profile.role || "buyer");
      const accounts = String(profile.accounts || "");
      return role === "buyer" || role === "both" || accounts === "buyer" || accounts === "both";
    });

    if (buyers.length === 0) {
      return json({ message: "No buyer profiles found to notify." });
    }

    const formattedPrice = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(price || 0);

    const notificationPayload = {
      source: "buysell-web-push",
      title: `New Product Live: ${name || "New item"}`,
      body: `${formattedPrice}${description ? ` - ${String(description).slice(0, 90)}` : ""}`,
      icon: image_url || `${siteUrl}/favicon.ico`,
      image: image_url || undefined,
      url: id ? `${siteUrl}/?view=shop&product=${encodeURIComponent(String(id))}` : `${siteUrl}/?view=shop`,
      tag: id ? `product-${id}` : "new-product",
    };

    const targets = await getPushTargetsForProfiles(admin, buyers);
    if (targets.length === 0) {
      return json({ message: "No buyer push subscriptions found to notify." });
    }

    const results: any[] = [];
    const failures: any[] = [];

    for (const target of targets) {
      try {
        await sendPushNotification(target.subscription, notificationPayload);
        results.push({ user_id: target.user_id, endpoint: target.endpoint });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failures.push({ user_id: target.user_id, endpoint: target.endpoint, error: errorMessage });

        const statusCode = Number((error as any)?.statusCode || 0);
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
      sent: results.length,
      failed: failures.length,
      targets: targets.length,
      skipped: Math.max(0, buyers.length - new Set(targets.map((target) => target.user_id)).size),
      failures,
    });
  } catch (error) {
    return fail(error);
  }
});
