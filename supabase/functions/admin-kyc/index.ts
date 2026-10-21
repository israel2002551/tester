import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

async function getAdminClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Supabase environment is not configured.");

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) throw new Error("Not authenticated");

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const adminEmails = (Deno.env.get("ADMIN_EMAILS") ?? Deno.env.get("ADMIN_EMAIL") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = String(authData.user.email || "").trim().toLowerCase();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,email")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role !== "admin" && !adminEmails.includes(email)) throw new Error("Admin access required");

  return { admin };
}

async function listKyc(admin: ReturnType<typeof createClient>, filter: string) {
  let query = admin
    .from("kyc_verifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "pending") {
    query = query.in("status", ["pending", "submitted", "in_review", "review"]);
  } else if (filter && filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data: rows, error } = await query;
  if (error) throw error;
  const userIds = [...new Set((rows || []).map((row: any) => row.user_id).filter(Boolean))];
  let profiles: any[] = [];
  if (userIds.length) {
    const { data, error: profileError } = await admin
      .from("profiles")
      .select("id,name,email,whatsapp")
      .in("id", userIds);
    if (profileError) throw profileError;
    profiles = data || [];
  }

  return { rows: rows || [], profiles };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { admin } = await getAdminClient(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");

    if (action === "list") {
      return json(await listKyc(admin, String(body.filter || "pending")));
    }

    const kycId = String(body.kyc_id || body.target_id || "");
    const userId = String(body.user_id || body.data?.user_id || "");
    if (!kycId || !userId) throw new Error("KYC id and user id are required.");

    if (action === "approve") {
      await Promise.all([
        admin.from("kyc_verifications").update({
          status: "approved",
          admin_note: "Approved by admin.",
          reviewed_at: new Date().toISOString(),
        }).eq("id", kycId),
        admin.from("profiles").update({
          kyc_status: "approved",
          verification_status: "verified",
          seller_verified: true,
        }).eq("id", userId),
      ]);
      return json({ ok: true, status: "approved" });
    }

    if (action === "reject") {
      const reason = String(body.reason || body.data?.reason || "Rejected by admin.");
      await Promise.all([
        admin.from("kyc_verifications").update({
          status: "rejected",
          admin_note: reason,
          reviewed_at: new Date().toISOString(),
        }).eq("id", kycId),
        admin.from("profiles").update({
          kyc_status: "rejected",
          verification_status: "rejected",
          seller_verified: false,
        }).eq("id", userId),
      ]);
      return json({ ok: true, status: "rejected" });
    }

    return json({ error: "Unsupported admin KYC action." }, 400);
  } catch (error) {
    console.error("admin-kyc error:", error);
    return json({ error: error instanceof Error ? error.message : "Admin KYC request failed." }, 400);
  }
});
