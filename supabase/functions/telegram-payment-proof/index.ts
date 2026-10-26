import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendTelegramToAdmins } from "../_shared/telegram.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new Error("Telegram payment notifications are not configured.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = String(body.order_id || "").trim();
    if (!orderId) return json({ error: "order_id is required" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id,buyer_id,total_amount,payment_method,payment_ref,proof_url,delivery_name,delivery_phone,delivery_address,created_at")
      .eq("id", orderId)
      .eq("buyer_id", authData.user.id)
      .maybeSingle();
    if (orderError || !order) return json({ error: "Order not found" }, 404);
    if (!order.proof_url || !/^https:\/\//i.test(order.proof_url)) {
      return json({ error: "A valid receipt is required" }, 400);
    }

    const amount = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(order.total_amount || 0));
    const caption = [
      "New BUYSELL payment receipt",
      `Order: ${order.id}`,
      `Amount: ${amount}`,
      `Reference: ${order.payment_ref || "Not provided"}`,
      `Buyer: ${order.delivery_name || "Unknown"} (${order.delivery_phone || "No phone"})`,
      `Delivery: ${order.delivery_address || "Not provided"}`,
      "Review the receipt in the BUYSELL admin Orders screen before confirming the order.",
    ].join("\n").slice(0, 1024);

    // Receipts in the private bucket need a signed URL for Telegram to fetch them.
    let photo = order.proof_url;
    const privatePath = String(order.proof_url).match(/\/storage\/v1\/object\/payment-proofs\/([^?]+)$/)?.[1];
    if (privatePath) {
      const { data: signed, error: signError } = await adminClient.storage
        .from("payment-proofs")
        .createSignedUrl(decodeURIComponent(privatePath), 3600);
      if (signError || !signed?.signedUrl) throw new Error("Could not prepare the receipt for Telegram.");
      photo = signed.signedUrl;
    }

    const result = await sendTelegramToAdmins("sendPhoto", { photo, caption });
    if (!result.sent) {
      throw new Error(result.reason || result.errors?.[0] || "Telegram could not accept the receipt notification.");
    }

    return json({ success: true });
  } catch (error) {
    console.error("telegram-payment-proof error:", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Could not notify Telegram." }, 400);
  }
});
