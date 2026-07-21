import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;

type KycRow = {
  id: string;
  user_id: string;
  doc_type?: string | null;
  document_type?: string | null;
  doc_number?: string | null;
  document_number?: string | null;
  full_name?: string | null;
  legal_name?: string | null;
  front_url?: string | null;
  back_url?: string | null;
  selfie_url?: string | null;
  status?: string | null;
};

type ProfileRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

type ProviderResult = {
  verified: boolean;
  reason: string;
  raw?: unknown;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const providerUrl = Deno.env.get("KYC_PROVIDER_URL") ?? "";
const providerApiKey = Deno.env.get("KYC_PROVIDER_API_KEY") ?? "";

function json(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDocNumber(value: unknown) {
  return String(value ?? "").trim().replace(/[\s-]/g, "").toUpperCase();
}

function getDocType(row: KycRow) {
  return normalize(row.doc_type || row.document_type);
}

function getDocNumber(row: KycRow) {
  return normalizeDocNumber(row.doc_number || row.document_number);
}

function getLegalName(row: KycRow) {
  return String(row.full_name || row.legal_name || "").trim();
}

function validateLocalRules(kyc: KycRow, profile: ProfileRow) {
  const errors: string[] = [];
  const docType = getDocType(kyc);
  const docNumber = getDocNumber(kyc);
  const legalName = getLegalName(kyc);
  const allowedDocTypes = new Set(["nin", "bvn", "drivers_license", "voters_card", "passport"]);

  if (!["seller", "both", "service_provider"].includes(String(profile.role || ""))) {
    errors.push("Profile is not a seller or service provider.");
  }
  if (!allowedDocTypes.has(docType)) errors.push("Unsupported document type.");
  if (docNumber.length < 6 || docNumber.length > 32) errors.push("Invalid document number length.");
  if (legalName.length < 5) errors.push("Legal name is too short.");
  if (!kyc.front_url) errors.push("Missing front document image.");
  if (!kyc.selfie_url) errors.push("Missing selfie image.");

  return errors;
}

async function callKycProvider(kyc: KycRow, profile: ProfileRow): Promise<ProviderResult> {
  if (!providerUrl) {
    return {
      verified: false,
      reason: "No KYC provider configured. Set KYC_PROVIDER_URL and KYC_PROVIDER_API_KEY.",
    };
  }

  const res = await fetch(providerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(providerApiKey ? { Authorization: `Bearer ${providerApiKey}` } : {}),
    },
    body: JSON.stringify({
      user_id: kyc.user_id,
      email: profile.email,
      name: getLegalName(kyc),
      document_type: getDocType(kyc),
      document_number: getDocNumber(kyc),
      front_url: kyc.front_url,
      back_url: kyc.back_url,
      selfie_url: kyc.selfie_url,
    }),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { verified: false, reason: `Provider request failed with HTTP ${res.status}.`, raw };
  }

  const status = normalize((raw as Json).status || (raw as Json).verification_status);
  const verified = (raw as Json).verified === true || ["verified", "approved", "success"].includes(status);
  const reason = String((raw as Json).reason || (raw as Json).message || (verified ? "Provider verified identity." : "Provider did not verify identity."));
  return { verified, reason, raw };
}

async function findKycRow(admin: ReturnType<typeof createClient>, userId: string, kycId?: string): Promise<KycRow | null> {
  let query = admin
    .from("kyc_verifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (kycId) query = query.eq("id", kycId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as KycRow | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Supabase environment variables are missing." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const kycId = typeof body.kyc_id === "string" ? body.kyc_id : undefined;
    const userId = authData.user.id;

    const [kyc, profileResult] = await Promise.all([
      findKycRow(admin, userId, kycId),
      admin.from("profiles").select("id,name,email,role").eq("id", userId).maybeSingle(),
    ]);

    if (!kyc) return json({ error: "KYC submission not found." }, 404);
    if (profileResult.error) throw profileResult.error;
    const profile = profileResult.data as ProfileRow | null;
    if (!profile) return json({ error: "Profile not found." }, 404);

    const localErrors = validateLocalRules(kyc, profile);
    if (localErrors.length) {
      await Promise.all([
        admin.from("kyc_verifications").update({
          status: "rejected",
          admin_note: localErrors.join(" "),
          reviewed_at: new Date().toISOString(),
        }).eq("id", kyc.id),
        admin.from("profiles").update({
          kyc_status: "rejected",
          verification_status: "rejected",
          seller_verified: false,
        }).eq("id", userId),
      ]);

      return json({
        ok: true,
        status: "rejected",
        verified: false,
        reason: localErrors.join(" "),
      });
    }

    const provider = await callKycProvider(kyc, profile);
    const nextStatus = provider.verified ? "approved" : "in_review";
    const profileStatus = provider.verified ? "verified" : "pending";

    await Promise.all([
      admin.from("kyc_verifications").update({
        status: nextStatus,
        admin_note: provider.reason,
        reviewed_at: new Date().toISOString(),
      }).eq("id", kyc.id),
      admin.from("profiles").update({
        kyc_status: nextStatus,
        verification_status: profileStatus,
        seller_verified: provider.verified,
      }).eq("id", userId),
    ]);

    return json({
      ok: true,
      status: nextStatus,
      verified: provider.verified,
      reason: provider.reason,
    });
  } catch (error) {
    console.error("auto-verify-kyc failed:", error);
    return json({ error: error instanceof Error ? error.message : "KYC verification failed." }, 500);
  }
});
