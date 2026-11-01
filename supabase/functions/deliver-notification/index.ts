import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webPush from "npm:web-push@3.6.7";

// Sends one notification from the notification center to the person's phones
// and computers. The database calls this through pg_net each time it adds a
// notification (supabase/migrations/20261102000000_notification_center.sql),
// signed with the project's anon key from Vault, so JWT verification stays on.
// It only ever sends a notification that exists, is recent and has not been
// sent yet.

const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "BEL_hMw0i1uDcH_jt52ReK7GbXtLW4IvVK_7pW5fGSl-2f7inbRJgednd3R8YRXas-xNles0ezQfXMkopIhuKok";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@buysell-marketplace.com";

const SETTING_FOR_KIND: Record<string, string> = { order: "orders", message: "messages", product: "products" };
const RECENT_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parseSubscription(value: unknown) {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { notification_id: id } = await req.json().catch(() => ({}));
    if (typeof id !== "string" || !UUID.test(id)) return json({ error: "A notification id is required." }, 400);
    if (!vapidPrivateKey) throw new Error("VAPID_PRIVATE_KEY is not configured.");

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    // Claim it first, so a repeated call can never send it twice.
    const { data: notification, error: claimError } = await admin
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .eq("id", id)
      .is("pushed_at", null)
      .gte("created_at", new Date(Date.now() - RECENT_MS).toISOString())
      .select("id,user_id,kind,title,body,data,group_key,item_count")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!notification) return json({ skipped: "Already sent, too old, or not found." });

    const setting = SETTING_FOR_KIND[notification.kind];
    if (setting) {
      const { data: settings } = await admin
        .from("notification_settings")
        .select("orders,messages,products")
        .eq("user_id", notification.user_id)
        .maybeSingle();
      if ((settings as Record<string, unknown> | null)?.[setting] === false) {
        return json({ skipped: `${setting} alerts are turned off.` });
      }
    }

    const targets = new Map<string, Record<string, unknown>>();
    const { data: rows } = await admin
      .from("push_subscriptions")
      .select("endpoint,subscription")
      .eq("user_id", notification.user_id);
    for (const row of rows || []) {
      const subscription = parseSubscription(row.subscription);
      const endpoint = String(row.endpoint || subscription?.endpoint || "");
      if (subscription && endpoint) targets.set(endpoint, subscription);
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("push_subscription_token")
      .eq("id", notification.user_id)
      .maybeSingle();
    const legacy = parseSubscription(profile?.push_subscription_token);
    if (legacy?.endpoint && !targets.has(String(legacy.endpoint))) targets.set(String(legacy.endpoint), legacy);
    if (!targets.size) return json({ skipped: "No phone or computer has alerts turned on." });

    const partner = notification.data?.partner_name;
    const title = notification.kind === "message" && notification.item_count > 1 && partner
      ? `${notification.item_count} new messages from ${partner}`
      : notification.title;
    const payload = JSON.stringify({
      source: "buysell-web-push",
      title,
      body: notification.body,
      // The site opens the right order or chat from this (and marks it read).
      url: `/?view=shop&notification=${notification.id}`,
      tag: notification.group_key || `notification-${notification.id}`,
      renotify: true,
      timestamp: Date.now(),
    });

    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    let sent = 0;
    let failed = 0;
    for (const [endpoint, subscription] of targets) {
      try {
        await webPush.sendNotification(subscription as never, payload);
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        // The browser was reset or the app removed: stop sending to it.
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
          if (legacy?.endpoint === endpoint) {
            await admin.from("profiles").update({ push_subscription_token: null }).eq("id", notification.user_id);
          }
        }
      }
    }
    return json({ sent, failed });
  } catch (error) {
    console.error("deliver-notification failed:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
