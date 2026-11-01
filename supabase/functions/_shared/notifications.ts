// Helpers for the notification center (supabase/migrations/20261102000000_notification_center.sql).
// Before that migration runs there are no notification tables: nobody has turned
// anything off, and the older per-feature alerts keep sending as before.

type Admin = { from: (table: string) => any };

// Users who turned a kind of alert off in their notification settings.
export async function usersWithAlertsOff(admin: Admin, setting: "orders" | "messages" | "products") {
  const { data, error } = await admin.from("notification_settings").select("user_id").eq(setting, false);
  if (error) return new Set<string>();
  return new Set<string>((data || []).map((row: { user_id: string }) => String(row.user_id)));
}

// True once the notification center sends order and message alerts itself.
export async function notificationCenterIsLive(admin: Admin) {
  const { error } = await admin.from("notifications").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}
