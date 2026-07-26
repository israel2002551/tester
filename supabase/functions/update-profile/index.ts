import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_FIELDS = new Set([
  "name",
  "whatsapp",
  "store_name",
  "store_category",
  "store_description",
  "bank_name",
  "account_number",
  "account_name",
  "paystack_key",
  "notif_email",
  "instagram_handle",
  "store_address",
  "logo_url",
]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown, max = 500) {
  if (value === null || value === undefined) return null;
  return String(value).trim().slice(0, max) || null;
}

function cleanAccountNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\D/g, "").slice(0, 20);
  return cleaned || null;
}

function cleanUrl(value: unknown) {
  const url = cleanString(value, 1500);
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function buildUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (key === "account_number") payload[key] = cleanAccountNumber(value);
    else if (key === "logo_url") payload[key] = cleanUrl(value);
    else if (key === "store_description") payload[key] = cleanString(value, 2000);
    else if (key === "paystack_key") payload[key] = cleanString(value, 300);
    else payload[key] = cleanString(value, 500);
  }
  return payload;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Supabase environment is not configured.");

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const payload = buildUpdatePayload(body);
    if (!Object.keys(payload).length) return json({ error: "No valid profile fields supplied." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile, error } = await admin
      .from("profiles")
      .update(payload)
      .eq("id", authData.user.id)
      .select("*")
      .single();

    if (error) throw error;
    return json({ ok: true, profile });
  } catch (error) {
    console.error("update-profile error:", error);
    return json({ error: error instanceof Error ? error.message : "Profile update failed." }, 400);
  }
});
