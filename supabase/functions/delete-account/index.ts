import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown> | any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function readJson(req: Request) {
  return await req.json().catch(() => ({}));
}

async function deleteWhere(admin: ReturnType<typeof createClient>, table: string, column: string, value: string) {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (error) console.warn(`Skipping ${table}.${column} cleanup:`, error.message);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Missing Supabase environment variables.");
    }

    const body = await readJson(req);
    if (body.confirm !== "DELETE") {
      return json({ error: "Deletion confirmation is required." }, 400);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const userId = authData.user.id;

    await Promise.all([
      deleteWhere(admin, "push_subscriptions", "user_id", userId),
      deleteWhere(admin, "messages", "sender_id", userId),
      deleteWhere(admin, "messages", "receiver_id", userId),
      deleteWhere(admin, "wishlist", "user_id", userId),
      deleteWhere(admin, "cart_items", "user_id", userId),
      deleteWhere(admin, "service_gigs", "provider_id", userId),
      deleteWhere(admin, "products", "seller_id", userId),
      deleteWhere(admin, "withdrawals", "seller_id", userId),
      deleteWhere(admin, "kyc_verifications", "user_id", userId),
      deleteWhere(admin, "ad_campaigns", "advertiser_id", userId),
      deleteWhere(admin, "advertisements", "user_id", userId),
      deleteWhere(admin, "profiles", "id", userId),
    ]);

    await admin
      .from("orders")
      .update({
        buyer_id: null,
        buyer_email: null,
        buyer_name: "Deleted account",
      })
      .eq("buyer_id", userId)
      .then(({ error }) => {
        if (error) console.warn("Buyer order anonymization skipped:", error.message);
      });

    await admin
      .from("orders")
      .update({
        seller_id: null,
        seller_name: "Deleted account",
      })
      .eq("seller_id", userId)
      .then(({ error }) => {
        if (error) console.warn("Seller order anonymization skipped:", error.message);
      });

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return json({ ok: true });
  } catch (error) {
    console.error("delete-account error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
