import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase function environment is not configured.");
    }

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in to send a message." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const user = authData.user;
    if (authError || !user) return json({ error: "Your sign-in session has expired. Please sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    const receiverId = asText(body.receiver_id, 80);
    const content = asText(body.content, 12_000);
    const productId = asText(body.product_id, 80);
    if (!receiverId || !content) return json({ error: "A recipient and message are required." }, 400);
    if (receiverId === user.id) return json({ error: "You cannot message yourself." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const message = {
      sender_id: user.id,
      receiver_id: receiverId,
      content,
      is_read: false,
      ...(productId ? { product_id: productId } : {}),
    };
    let { data, error } = await admin.from("messages").insert(message).select().single();

    // Product context is optional. Preserve the chat even if an old product was removed.
    if (error && productId && /foreign key|fkey/i.test(error.message || "")) {
      ({ data, error } = await admin.from("messages").insert({
        sender_id: user.id,
        receiver_id: receiverId,
        content,
        is_read: false,
      }).select().single());
    }
    if (error) throw error;
    return json({ message: data });
  } catch (error) {
    console.error("send-message failed:", error);
    return json({ error: error instanceof Error ? error.message : "Could not send message." }, 500);
  }
});
