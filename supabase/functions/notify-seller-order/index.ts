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

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}

const siteUrl = Deno.env.get("SITE_URL") ?? "https://buysell-markerplace.com";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "BEL_hMw0i1uDcH_jt52ReK7GbXtLW4IvVK_7pW5fGSl-2f7inbRJgednd3R8YRXas-xNles0ezQfXMkopIhuKok";
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

type PushTarget = {
  user_id: string;
  endpoint?: string;
  subscription: any;
};

async function getPushTargetsForUser(admin: ReturnType<typeof createClient>, userId: string, fallbackToken?: unknown) {
  const targets: PushTarget[] = [];
  const seen = new Set<string>();

  const { data: rows, error: tableError } = await admin
    .from("push_subscriptions")
    .select("user_id,endpoint,subscription")
    .eq("user_id", userId);

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

  const fallback = parsePushSubscription(fallbackToken);
  if (fallback?.endpoint && !seen.has(fallback.endpoint)) {
    targets.push({ user_id: userId, endpoint: fallback.endpoint, subscription: fallback });
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

function summarizeItems(items: unknown) {
  try {
    const parsedItems = typeof items === "string" ? JSON.parse(items) : items;
    if (!Array.isArray(parsedItems) || parsedItems.length === 0) return "Open your dashboard for order details.";

    return parsedItems
      .slice(0, 3)
      .map((item: any) => `${item.name || "Product"} x ${item.qty || 1}`)
      .join(", ");
  } catch (error) {
    console.warn("Failed to parse order items:", error);
    return "Open your dashboard for order details.";
  }
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

    if (record?.status !== "confirmed") {
      return json({ message: "Order is not confirmed. Skipping notification." });
    }

    if (type === "UPDATE" && old_record?.status === "confirmed") {
      return json({ message: "Order was already confirmed. Skipping notification." });
    }

    const { id: orderId, total_amount, seller_id, items } = record;

    if (!seller_id) {
      return json({ error: "No seller_id associated with order" }, 400);
    }

    const { data: sellerProfile, error: sellerError } = await admin
      .from("profiles")
      .select("id,name,push_subscription_token")
      .eq("id", seller_id)
      .maybeSingle();

    if (sellerError || !sellerProfile) {
      throw new Error(`Failed to fetch seller profile: ${sellerError?.message || "Profile not found"}`);
    }

    const targets = await getPushTargetsForUser(admin, seller_id, sellerProfile.push_subscription_token);
    if (targets.length === 0) {
      return json({ message: "Seller has no push subscription to notify.", seller_id });
    }

    const notificationPayload = {
      source: "buysell-web-push",
      title: `New Order Paid: #${orderId}`,
      body: `${money(total_amount)} - ${summarizeItems(items)}`,
      icon: `${siteUrl}/favicon.ico`,
      url: `${siteUrl}/?dashboard=seller&order=${encodeURIComponent(String(orderId))}`,
      tag: `order-${orderId}`,
    };

    const results: any[] = [];
    const failures: any[] = [];

    for (const target of targets) {
      try {
        await sendPushNotification(target.subscription, notificationPayload);
        results.push({ user_id: target.user_id, endpoint: target.endpoint });
      } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 0);
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ user_id: target.user_id, endpoint: target.endpoint, error: message });

        if (statusCode === 404 || statusCode === 410) {
          if (target.endpoint) {
            await admin.from("push_subscriptions").delete().eq("endpoint", target.endpoint);
          }
          await admin.from("profiles").update({ push_subscription_token: null }).eq("id", seller_id);
        }
      }
    }

    return json({
      success: results.length > 0,
      message: `Web push notification processed for seller: ${seller_id}`,
      targets: targets.length,
      sent: results.length,
      failed: failures.length,
      failures,
    });
  } catch (error) {
    return fail(error);
  }
});
