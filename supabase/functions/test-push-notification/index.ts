import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webPush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const siteUrl = Deno.env.get("SITE_URL") ?? "https://buysell-markerplace.com";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "BEL_hMw0i1uDcH_jt52ReK7GbXtLW4IvVK_7pW5fGSl-2f7inbRJgednd3R8YRXas-xNles0ezQfXMkopIhuKok";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@buysell-markerplace.com";

function json(body: Record<string, unknown> | any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

async function sendPushNotification(subscription: any, payload: Record<string, unknown>) {
  if (!vapidPrivateKey) throw new Error("VAPID_PRIVATE_KEY is not configured.");
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return await webPush.sendNotification(subscription, JSON.stringify(payload));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!vapidPrivateKey) {
      return json({
        error: "Server push is not configured yet. Set the VAPID_PRIVATE_KEY Supabase secret, then redeploy the push functions.",
      }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sign in before testing push notifications." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return json({ error: "Invalid or expired session. Please sign in again." }, 401);
    }

    const userId = userData.user.id;
    const { title, body, url } = await req.json().catch(() => ({}));
    const now = Date.now();
    const payload = {
      source: "buysell-web-push",
      title: String(title || "BUYSELL Nigeria"),
      body: String(body || "Background notifications are active for this device."),
      icon: `${siteUrl}/favicon.ico`,
      badge: `${siteUrl}/favicon.ico`,
      url: String(url || `${siteUrl}/?view=shop`),
      tag: `test-push-${userId}-${now}`,
      timestamp: now,
      requireInteraction: true,
      renotify: true,
      vibrate: [120, 80, 120],
    };

    const targets: { endpoint: string; subscription: any }[] = [];
    const seen = new Set<string>();

    const { data: rows, error: tableError } = await admin
      .from("push_subscriptions")
      .select("endpoint,subscription")
      .eq("user_id", userId);

    if (!tableError) {
      for (const row of rows || []) {
        const subscription = parsePushSubscription(row.subscription);
        const endpoint = row.endpoint || subscription?.endpoint;
        if (subscription && endpoint && !seen.has(endpoint)) {
          seen.add(endpoint);
          targets.push({ endpoint, subscription });
        }
      }
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("push_subscription_token")
      .eq("id", userId)
      .maybeSingle();

    const fallback = parsePushSubscription(profile?.push_subscription_token);
    if (fallback?.endpoint && !seen.has(fallback.endpoint)) {
      targets.push({ endpoint: fallback.endpoint, subscription: fallback });
    }

    if (targets.length === 0) {
      return json({ error: "No saved push subscription found for this user/device." }, 404);
    }

    const sent: string[] = [];
    const failures: any[] = [];
    for (const target of targets) {
      try {
        await sendPushNotification(target.subscription, payload);
        sent.push(target.endpoint);
      } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 0);
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ endpoint: target.endpoint, error: message });
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", target.endpoint);
          await admin.from("profiles").update({ push_subscription_token: null }).eq("id", userId);
        }
      }
    }

    const firstFailure = failures[0]?.error ? String(failures[0].error) : "";
    return json({
      success: sent.length > 0,
      error: sent.length > 0 ? undefined : firstFailure || "Push delivery failed for every saved device subscription.",
      targets: targets.length,
      sent: sent.length,
      failed: failures.length,
      failures,
    }, sent.length > 0 ? 200 : 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, message.includes("VAPID_PRIVATE_KEY") ? 500 : 400);
  }
});
