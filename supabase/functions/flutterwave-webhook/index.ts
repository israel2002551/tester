import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, verif-hash",
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
  return message.match(/column .*?\.([a-zA-Z0-9_]+) does not exist/)?.[1] || "";
}

async function updateWithMissingColumnRetry(
  client: any,
  table: string,
  row: Record<string, unknown>,
  matcher: (query: any) => any,
) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await matcher(client.from(table).update(payload)).select("id").maybeSingle();
    if (!error) return data;
    const col = missingColumn(error);
    if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
      delete payload[col];
      continue;
    }
    throw error;
  }
  throw new Error(`Could not update ${table}`);
}

async function verifyFlutterwaveTransaction(transactionId: string, secretKey: string) {
  const res = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const body = await res.json();
  if (!res.ok || body?.status !== "success") {
    throw new Error(body?.message || "Flutterwave transaction verification failed");
  }
  return body.data || {};
}

function orPaymentRef(refA: string, refB: string) {
  const values = Array.from(new Set([refA, refB].filter(Boolean)));
  if (!values.length) return "";
  return values.flatMap((ref) => [
    `payment_ref.eq.${ref}`,
    `payment_reference.eq.${ref}`,
  ]).join(",");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ received: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const flutterwaveSecret = Deno.env.get("FLUTTERWAVE_SECRET_KEY") || "";
    const webhookHash = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET_HASH") || "";
    if (!supabaseUrl || !serviceKey || !flutterwaveSecret || !webhookHash) {
      throw new Error("Flutterwave webhook is not configured");
    }

    const signature = req.headers.get("verif-hash") || "";
    if (!signature || signature !== webhookHash) {
      return json({ received: false, error: "Invalid webhook signature" }, 401);
    }

    const event = await req.json();
    const eventName = String(event.event || event.type || "");
    const data = event.data || {};
    const transactionId = String(data.id || data.transaction_id || "");
    if (!transactionId) return json({ received: true, ignored: true, reason: "Missing transaction id" });

    const tx = await verifyFlutterwaveTransaction(transactionId, flutterwaveSecret);
    if (String(tx.status || "").toLowerCase() !== "successful") {
      return json({ received: true, ignored: true, reason: "Transaction not successful", event: eventName });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const txRef = String(tx.tx_ref || data.tx_ref || "");
    const flwRef = String(tx.flw_ref || data.flw_ref || "");
    const amount = Number(tx.amount || data.amount || 0);
    const currency = String(tx.currency || data.currency || "NGN").toUpperCase();
    const meta = tx.meta || data.meta || data.metadata || {};
    const paymentType = String(meta.type || meta.order_type || "").toLowerCase();
    const refFilter = orPaymentRef(flwRef, txRef);

    let order = null;
    if (refFilter) {
      order = await updateWithMissingColumnRetry(
        admin,
        "orders",
        {
          status: "confirmed",
          payment_status: "paid",
          payment_method: "flutterwave",
          payment_ref: flwRef || txRef,
          payment_reference: flwRef || txRef,
          flutterwave_transaction_id: transactionId,
          paid_amount: amount,
          currency,
          updated_at: new Date().toISOString(),
        },
        (query) => query.or(refFilter),
      ).catch(() => null);
    }

    let ad = null;
    if (refFilter && (paymentType === "advertisement" || txRef.startsWith("ad_"))) {
      ad = await updateWithMissingColumnRetry(
        admin,
        "advertisements",
        {
          status: "pending",
          payment_status: "paid",
          payment_method: "flutterwave",
          payment_ref: flwRef || txRef,
          payment_reference: flwRef || txRef,
          flutterwave_transaction_id: transactionId,
          paid_amount: amount,
          currency,
          updated_at: new Date().toISOString(),
        },
        (query) => query.or(refFilter),
      ).catch(() => null);
    }

    if (order?.id) {
      await admin.from("order_tracking").insert({
        order_id: order.id,
        status: "confirmed",
        note: "Flutterwave payment webhook confirmed. BUYSELL delivery team will manage pickup and tracking.",
        created_at: new Date().toISOString(),
      }).catch(() => null);
    }

    return json({
      received: true,
      verified: true,
      event: eventName,
      tx_ref: txRef,
      flw_ref: flwRef,
      order_id: order?.id || null,
      ad_id: ad?.id || null,
    });
  } catch (error) {
    console.error("Flutterwave webhook failed:", error);
    return json({ received: false, error: (error as Error).message || "Webhook processing failed" }, 400);
  }
});
