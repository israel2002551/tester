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
  accounts?: string | null;
};

type AiReviewResult = {
  status: "in_review" | "rejected";
  aiPassed: boolean;
  reason: string;
  raw?: unknown;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openAiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openAiModel = Deno.env.get("OPENAI_KYC_MODEL") ?? "gpt-5-mini";

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

  const role = String(profile.role || "");
  const accounts = String(profile.accounts || "");
  if (!["seller", "both", "service_provider", "admin"].includes(role) && !["seller", "both", "service_provider"].includes(accounts)) {
    errors.push("Profile is not a seller or service provider.");
  }
  if (!allowedDocTypes.has(docType)) errors.push("Unsupported document type.");
  if (docNumber.length < 6 || docNumber.length > 32) errors.push("Invalid document number length.");
  if (legalName.length < 5) errors.push("Legal name is too short.");
  if (!kyc.front_url) errors.push("Missing front document image.");
  if (!kyc.selfie_url) errors.push("Missing selfie image.");

  return errors;
}

function parseAiJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  return JSON.parse(candidate);
}

function extractOutputText(raw: Json) {
  if (typeof raw.output_text === "string") return raw.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(raw.output) ? raw.output : []) {
    const content = (item as Json).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const text = (block as Json).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

async function callOpenAiKycReview(kyc: KycRow, profile: ProfileRow): Promise<AiReviewResult> {
  if (!openAiApiKey) {
    return {
      status: "in_review",
      aiPassed: false,
      reason: "OpenAI KYC review is not configured. Set OPENAI_API_KEY.",
    };
  }

  const expectedDocType = getDocType(kyc);
  const expectedDocNumber = getDocNumber(kyc);
  const expectedName = getLegalName(kyc);
  const content: Record<string, unknown>[] = [
    {
      type: "input_text",
      text: [
        "You are reviewing seller KYC documents for a marketplace.",
        "Do not identify or compare faces. Do not claim government-record validation.",
        "Only inspect document image quality, visible text, document type, and whether the submitted number/name appear to match the visible document.",
        "Return only valid JSON with keys: decision, reason, extracted_document_type, extracted_document_number, extracted_name, doc_number_matches, name_looks_consistent, image_quality, tamper_or_fake_signals.",
        "decision must be one of: pass_for_manual_review, reject, needs_manual_review.",
        `Submitted document type: ${expectedDocType}`,
        `Submitted document number: ${expectedDocNumber}`,
        `Submitted legal name: ${expectedName}`,
        `Seller profile name/email: ${profile.name || ""} / ${profile.email || ""}`,
      ].join("\n"),
    },
    { type: "input_image", image_url: kyc.front_url },
  ];

  if (kyc.back_url) content.push({ type: "input_image", image_url: kyc.back_url });
  if (kyc.selfie_url) {
    content.push({
      type: "input_text",
      text: "The next image is a selfie/holder image. Use it only to check basic submission quality and whether an ID document is present; do not perform face recognition.",
    });
    content.push({ type: "input_image", image_url: kyc.selfie_url });
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: openAiModel,
      input: [{ role: "user", content }],
    }),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { status: "in_review", aiPassed: false, reason: `OpenAI review failed with HTTP ${res.status}.`, raw };
  }

  const outputText = extractOutputText(raw as Json);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = outputText ? parseAiJson(outputText) : {};
  } catch {
    return {
      status: "in_review",
      aiPassed: false,
      reason: "AI pre-check returned an unreadable response. Manual review required.",
      raw,
    };
  }
  const decision = normalize(parsed.decision);
  const extractedNumber = normalizeDocNumber(parsed.extracted_document_number);
  const numberMatches = parsed.doc_number_matches === true || Boolean(expectedDocNumber && extractedNumber === expectedDocNumber);
  const imageQuality = normalize(parsed.image_quality);
  const tamperSignals = String(parsed.tamper_or_fake_signals || "").trim();
  const reject = decision === "reject" || imageQuality === "unreadable" || (!numberMatches && decision !== "needs_manual_review");
  const aiPassed = !reject && numberMatches && decision === "pass_for_manual_review";
  const reason = String(parsed.reason || (aiPassed ? "AI pre-check passed. Admin review still required." : "AI pre-check needs manual review."));

  return {
    status: reject ? "rejected" : "in_review",
    aiPassed,
    reason: tamperSignals ? `${reason} Signals: ${tamperSignals}` : reason,
    raw: { ...raw, parsed },
  };
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
      admin.from("profiles").select("id,name,email,role,accounts").eq("id", userId).maybeSingle(),
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
          kyc_status: "in_review",
          verification_status: "pending",
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

    const aiReview = await callOpenAiKycReview(kyc, profile);
    const nextStatus = aiReview.status;
    const profileStatus = "pending";

    await Promise.all([
      admin.from("kyc_verifications").update({
        status: nextStatus,
        admin_note: aiReview.reason,
        reviewed_at: new Date().toISOString(),
      }).eq("id", kyc.id),
      admin.from("profiles").update({
        kyc_status: nextStatus === "rejected" ? "in_review" : nextStatus,
        verification_status: profileStatus,
        seller_verified: false,
      }).eq("id", userId),
    ]);

    return json({
      ok: true,
      status: nextStatus,
      verified: false,
      ai_passed: aiReview.aiPassed,
      reason: aiReview.reason,
    });
  } catch (error) {
    console.error("auto-verify-kyc failed:", error);
    return json({ error: error instanceof Error ? error.message : "KYC verification failed." }, 500);
  }
});
