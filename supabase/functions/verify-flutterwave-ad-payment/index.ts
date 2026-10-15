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
    const adPrice = Number(Deno.env.get("AD_PRICE_NGN") || 5000);
    const expectedAmount = Math.max(Number(payload.expected_amount || 0), adPrice);
    const expectedCurrency = String(payload.currency || "NGN").toUpperCase();
    const expectedTxRef = String(payload.tx_ref || "");
    if (!transactionId || !expectedTxRef) {
      throw new Error("Missing ad payment verification details");
    }

    const verifyRes = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`, {
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

    const paymentRef = String(tx.flw_ref || expectedTxRef);
    const { data: existingAd } = await admin
      .from("advertisements")
      .select("id,seller_id")
      .in("payment_ref", Array.from(new Set([paymentRef, expectedTxRef])))
      .limit(1)
      .maybeSingle();
    if (existingAd?.id) {
      if (existingAd.seller_id === authData.user.id) return json({ success: true, ad_id: existingAd.id });
      throw new Error("This payment has already been used");
    }

    const adData = payload.adData || {};
    const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);
    const ad = await insertWithMissingColumnRetry(admin, "advertisements", {
      title: text(adData.title, 120),
      description: text(adData.description, 600),
      media_url: text(adData.media_url, 1000),
      media_type: adData.media_type === "video" ? "video" : "image",
      cta_text: text(adData.cta_text, 40),
      cta_link: text(adData.cta_link, 1000),
      seller_id: authData.user.id,
      advertiser_id: authData.user.id,
      status: "pending",
      payment_method: "flutterwave",
      payment_ref: paymentRef,
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
