import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function cleanText(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

async function markAllocationsFunded(admin: any, orderId: string) {
  const { error } = await admin
    .from("order_seller_allocations")
    .update({ payout_status: "funded", funded_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("payout_status", "pending");
  if (error) throw new Error("Payment was confirmed, but seller allocation funding could not be recorded.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const flutterwaveSecret = Deno.env.get("FLUTTERWAVE_SECRET_KEY") || "";
    if (!supabaseUrl || !serviceKey || !flutterwaveSecret) {
      throw new Error("Payment verification is not configured");
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Not authenticated");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) throw new Error("Invalid session");

    const payload = await req.json().catch(() => ({}));
    const transactionId = cleanText(payload?.transaction_id ?? payload?.id, 120);
    const expectedTxRef = cleanText(payload?.tx_ref, 180);
    const expectedCurrency = cleanText(payload?.currency || "NGN", 10).toUpperCase();
    const orderId = cleanText(payload?.order_id, 100);
    if (!transactionId || !expectedTxRef || !orderId) {
      throw new Error("Missing payment verification details");
    }

    // Flutterwave orders are created first by bogo-promo's
    // `create_flutterwave_pending` action. That action is the sole authority
    // for cart pricing, gift eligibility, and seller allocation creation.
    const { data: pendingOrder, error: orderError } = await admin
      .from("orders")
      .select("id,total_amount,status,payment_ref,payment_method")
      .eq("id", orderId)
      .eq("buyer_id", authData.user.id)
      .maybeSingle();
    if (orderError || !pendingOrder) throw new Error("Pending checkout order was not found");
    if (String(pendingOrder.payment_method || "").toLowerCase() !== "flutterwave") {
      throw new Error("This order is not awaiting a Flutterwave payment");
    }

    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
      { method: "GET", headers: { Authorization: `Bearer ${flutterwaveSecret}` } },
    );
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData?.status !== "success") {
      throw new Error(verifyData?.message || "Flutterwave verification failed");
    }

    const tx = verifyData.data || {};
    const paidAmount = money(tx.amount);
    const paymentRef = cleanText(tx.flw_ref || expectedTxRef, 180);
    if (String(tx.status || "").toLowerCase() !== "successful") throw new Error("Payment was not successful");
    if (String(tx.currency || "").toUpperCase() !== expectedCurrency) throw new Error("Payment currency mismatch");
    if (String(tx.tx_ref || "") !== expectedTxRef) throw new Error("Payment reference mismatch");

    const requiredAmount = money(pendingOrder.total_amount);
    if (requiredAmount <= 0 || paidAmount + 0.01 < requiredAmount) throw new Error("Payment amount mismatch");

    // A payment reference can settle only one order. A pending order may still
    // use its client tx_ref, while a confirmed one is updated to flw_ref.
    const { data: usedBy, error: usedError } = await admin
      .from("orders")
      .select("id")
      .in("payment_ref", Array.from(new Set([paymentRef, expectedTxRef])))
      .neq("status", "pending");
    if (usedError) throw usedError;
    if ((usedBy || []).some((row: any) => row.id !== pendingOrder.id)) {
      throw new Error("This payment has already been used for another order");
    }

    if (pendingOrder.status !== "pending") {
      if (String(pendingOrder.payment_ref || "") !== paymentRef) throw new Error("This order has already been processed");
      await markAllocationsFunded(admin, pendingOrder.id);
      return json({ success: true, order_id: pendingOrder.id, total_paid: paidAmount, idempotent: true });
    }
    if (String(pendingOrder.payment_ref || "") !== expectedTxRef) throw new Error("Payment reference mismatch");

    const { data: confirmedOrder, error: updateError } = await admin
      .from("orders")
      .update({ status: "confirmed", payment_method: "flutterwave", payment_ref: paymentRef })
      .eq("id", pendingOrder.id)
      .eq("status", "pending")
      .select("id,total_amount")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!confirmedOrder) {
      const { data: latest } = await admin
        .from("orders")
        .select("id,status,payment_ref,total_amount")
        .eq("id", pendingOrder.id)
        .maybeSingle();
      if (!latest || latest.status === "pending" || String(latest.payment_ref || "") !== paymentRef) {
        throw new Error("This order has already been processed");
      }
      await markAllocationsFunded(admin, latest.id);
      return json({ success: true, order_id: latest.id, total_paid: paidAmount, idempotent: true });
    }

    await markAllocationsFunded(admin, confirmedOrder.id);
    try {
      await admin.from("order_tracking").insert({
        order_id: confirmedOrder.id,
        status: "confirmed",
        note: "Payment verified. BUYSELL delivery team will arrange pickup from the seller.",
        created_at: new Date().toISOString(),
      });
    } catch (_) {
      // Tracking is optional on older installations.
    }

    // Keep the server-priced order total immutable; `total_paid` reports the
    // processor amount in case Flutterwave accepted an overpayment.
    return json({ success: true, order_id: confirmedOrder.id, total_paid: paidAmount });
  } catch (error) {
    return json({ success: false, error: (error as Error).message || "Payment verification failed" }, 400);
  }
});
