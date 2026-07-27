import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SELLER_ROLES = new Set(["seller", "admin", "both", "service_provider"]);
const MIN_WITHDRAWAL = 5000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanAccountNumber(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 20);
}

async function getAuthedUser(req: Request, supabaseUrl: string, anonKey: string) {
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user;
}

async function ensureSellerAccess(admin: any, userId: string) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,role,accounts,is_suspended,bank_name,account_number,account_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  const role = String(profile?.role || "");
  const accounts = String(profile?.accounts || "");
  const hasAccess = SELLER_ROLES.has(role) || SELLER_ROLES.has(accounts);
  if (!hasAccess) throw new Error("Seller account required. Please sign in with a seller account.");
  if (profile?.is_suspended === true) throw new Error("Seller account suspended. Please contact support.");

  await admin.from("profiles").update({
    commission_paid: true,
    trial_end: null,
  }).eq("id", userId);

  return profile || {};
}

async function getAvailableRevenue(admin: any, sellerId: string) {
  const [{ data: orders }, { data: withdrawals }, { data: walletTransactions }] = await Promise.all([
    admin.from("orders").select("total_amount,status").eq("seller_id", sellerId),
    admin.from("withdrawals").select("amount,status").eq("seller_id", sellerId),
    admin.from("wallet_transactions").select("amount,type").eq("seller_id", sellerId),
  ]);

  const revenue = (orders || [])
    .filter((order: any) => String(order.status || "") === "delivered")
    .reduce((sum: number, order: any) => sum + Number(order.total_amount || 0), 0);
  const pending = (withdrawals || [])
    .filter((withdrawal: any) => ["pending", "processing", "in_review"].includes(String(withdrawal.status || "")))
    .reduce((sum: number, withdrawal: any) => sum + Number(withdrawal.amount || 0), 0);
  const paid = (withdrawals || [])
    .filter((withdrawal: any) => ["paid", "completed"].includes(String(withdrawal.status || "")))
    .reduce((sum: number, withdrawal: any) => sum + Number(withdrawal.amount || 0), 0);
  const walletDebits = (walletTransactions || [])
    .filter((transaction: any) => String(transaction.type || "").startsWith("debit"))
    .reduce((sum: number, transaction: any) => sum + Number(transaction.amount || 0), 0);

  return {
    revenue,
    pending,
    paid,
    walletDebits,
    available: Math.max(0, revenue - pending - paid - walletDebits),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Supabase environment is not configured.");

    const user = await getAuthedUser(req, supabaseUrl, anonKey);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const profile = await ensureSellerAccess(admin, user.id);
    const body = await req.json().catch(() => ({}));

    const amount = Math.round(Number(body.amount || 0));
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) throw new Error("Minimum withdrawal is ₦5,000.");

    const bankName = cleanString(body.bank_name || profile.bank_name, 120);
    const accountNumber = cleanAccountNumber(body.account_number || profile.account_number);
    const accountName = cleanString(body.account_name || profile.account_name, 160);
    if (!bankName || !accountNumber || !accountName) {
      throw new Error("Please update your bank name, account number, and account name before requesting withdrawal.");
    }

    const wallet = await getAvailableRevenue(admin, user.id);
    if (amount > wallet.available) {
      throw new Error(`Insufficient balance. You can withdraw up to ₦${Math.round(wallet.available).toLocaleString("en-NG")}.`);
    }

    const reference = `wd_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const { data: withdrawal, error } = await admin
      .from("withdrawals")
      .insert({
        seller_id: user.id,
        amount,
        status: "pending",
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
        reference,
        created_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) throw error;
    return json({ ok: true, withdrawal, available: wallet.available - amount });
  } catch (error) {
    console.error("request-withdrawal error:", error);
    return json({ error: error instanceof Error ? error.message : "Withdrawal request failed." }, 400);
  }
});
