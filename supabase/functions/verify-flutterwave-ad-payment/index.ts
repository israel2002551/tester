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
  return message.match(/column .*?\.([a-zA-Z0-9_]+) does not exist/)?.[1] || "";
}

async function insertWithMissingColumnRetry(client: any, table: string, row: Record<string, unknown>) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await client.from(table).insert(payload).select("id").maybeSingle();
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
      throw new Error("Ad payment verification is not configured");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Not authenticated");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) throw new Error("Invalid session");

    const payload = await req.json();
    const transactionId = payload.transaction_id || payload.id;
    const expectedAmount = Number(payload.expected_amount || 0);
    const expectedCurrency = String(payload.currency || "NGN").toUpperCase();
    const expectedTxRef = String(payload.tx_ref || "");
    if (!transactionId || !expectedTxRef || expectedAmount <= 0) {
      throw new Error("Missing ad payment verification details");
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

    const adData = payload.adData || {};
    const ad = await insertWithMissingColumnRetry(admin, "advertisements", {
      ...adData,
      seller_id: authData.user.id,
      advertiser_id: authData.user.id,
      status: "pending",
      payment_method: "flutterwave",
      payment_ref: String(tx.flw_ref || expectedTxRef),
      paid_amount: Number(tx.amount || expectedAmount),
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    });

    return json({ success: true, ad_id: ad?.id || null });
  } catch (error) {
    return json({ success: false, error: (error as Error).message || "Ad payment verification failed" }, 400);
  }
});
