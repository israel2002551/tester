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

function missingColumn(error: unknown) {
  const message = String((error as { message?: string })?.message || "");
  return message.match(/column .*?\.([a-zA-Z0-9_]+) does not exist/)?.[1]
    || message.match(/Could not find the ['\"]([a-zA-Z0-9_]+)['\"] column/i)?.[1]
    || "";
}

async function insertWithMissingColumnRetry(client: any, table: string, row: Record<string, unknown>) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await client.from(table).insert(payload).select("id,total_amount").maybeSingle();
    if (!error) return data;
    const col = missingColumn(error);
    if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
      delete payload[col];
      continue;
    }
    throw error;
  }
  throw new Error(`Could not insert ${table}`);
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

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Not authenticated");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) throw new Error("Invalid session");

    const payload = await req.json();
    const cart = Array.isArray(payload.cart) ? payload.cart : [];
    const sellerId = cart[0]?.seller_id;
    const expectedAmount = Number(payload.expected_amount || 0);
    const expectedCurrency = String(payload.currency || "NGN").toUpperCase();
    const expectedTxRef = String(payload.tx_ref || "");

    // Reserve an order before opening Flutterwave. If the buyer closes the
    // checkout after paying, the webhook can still locate this order by ref.
    if (payload.action === "create_pending") {
      if (!expectedTxRef || expectedAmount <= 0 || !cart.length || !sellerId) {
        throw new Error("Missing order details");
      }
      const orderId = crypto.randomUUID();
      const order = await insertWithMissingColumnRetry(admin, "orders", {
        id: orderId,
        buyer_id: authData.user.id,
        seller_id: sellerId,
        items: cart,
        total_amount: expectedAmount,
        status: "pending",
        payment_method: "flutterwave",
        payment_ref: expectedTxRef,
        delivery_name: String(payload.delivery_name || ""),
        delivery_phone: String(payload.delivery_phone || ""),
        delivery_address: String(payload.delivery_address || ""),
        shipping_total: Number(payload.shipping_total || 0),
        shipping_groups: payload.shipping_groups || [],
        created_at: new Date().toISOString(),
      });
      return json({ success: true, order_id: order?.id || orderId, pending: true });
    }

    const transactionId = payload.transaction_id || payload.id;
    if (!transactionId || !expectedTxRef || expectedAmount <= 0) {
      throw new Error("Missing payment verification details");
    }

    const verifyRes = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
      method: "GET",
      headers: { Authorization: `Bearer ${flutterwaveSecret}` },
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData?.status !== "success") {
      throw new Error(verifyData?.message || "Flutterwave verification failed");
    }

    const tx = verifyData.data || {};
    if (String(tx.status || "").toLowerCase() !== "successful") throw new Error("Payment was not successful");
    if (String(tx.currency || "").toUpperCase() !== expectedCurrency) throw new Error("Payment currency mismatch");
    if (String(tx.tx_ref || "") !== expectedTxRef) throw new Error("Payment reference mismatch");
    if (Number(tx.amount || 0) < expectedAmount) throw new Error("Payment amount mismatch");

    if (!cart.length || !sellerId) throw new Error("Cart or seller information missing");

    const existingOrderId = String(payload.order_id || "");
    let order = null;
    if (existingOrderId) {
      const { data: existingOrder } = await admin
        .from("orders")
        .select("id")
        .eq("id", existingOrderId)
        .eq("buyer_id", authData.user.id)
        .maybeSingle();
      if (existingOrder?.id) {
        const { data, error } = await admin.from("orders").update({
          status: "confirmed",
          payment_method: "flutterwave",
          payment_ref: String(tx.flw_ref || expectedTxRef),
          total_amount: Number(tx.amount || expectedAmount),
        }).eq("id", existingOrder.id).select("id,total_amount").maybeSingle();
        if (error) throw error;
        order = data;
      }
    }

    const orderId = existingOrderId || crypto.randomUUID();
    if (!order) order = await insertWithMissingColumnRetry(admin, "orders", {
      id: orderId,
      buyer_id: authData.user.id,
      seller_id: sellerId,
      items: cart,
      total_amount: Number(tx.amount || expectedAmount),
      status: "confirmed",
      payment_method: "flutterwave",
      payment_ref: String(tx.flw_ref || expectedTxRef),
      delivery_name: String(payload.delivery_name || ""),
      delivery_phone: String(payload.delivery_phone || ""),
      delivery_address: String(payload.delivery_address || ""),
      shipping_total: Number(payload.shipping_total || 0),
      shipping_groups: payload.shipping_groups || [],
      created_at: new Date().toISOString(),
    });

    try {
      await admin.from("order_tracking").insert({
        order_id: order?.id || orderId,
        status: "confirmed",
        note: "Payment verified. BUYSELL delivery team will arrange pickup from the seller.",
        created_at: new Date().toISOString(),
      });
    } catch (_) {
      // Tracking table may not exist on older databases.
    }

    return json({ success: true, order_id: order?.id || orderId, total_paid: Number(tx.amount || expectedAmount) });
  } catch (error) {
    return json({ success: false, error: (error as Error).message || "Payment verification failed" }, 400);
  }
});
