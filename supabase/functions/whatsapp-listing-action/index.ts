import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-whatsapp-ingest-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRODUCT_COLUMNS = "id,seller_id,name,description,price,original_price,shipping_fee,shipping_cost,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,negotiable";
const NATIVE_CATEGORIES = new Set(["electronics", "fashion", "home", "phones", "beauty", "sports", "dropship", "other"]);
const NATIVE_CONDITIONS = new Set(["new", "used-like-new", "used-good"]);
const WHATSAPP_PRICE_MARKUP_PERCENT = 20;
// These were the original Bot 2 allow-listed groups. Keep them valid while
// their settings are being migrated to whatsapp_group_settings in this project.
const LEGACY_LISTED_GROUPS = new Set([
  "120363405967163832@g.us",
  "2348115894343-1610476263@g.us",
  "120363423548052642@g.us",
  "120363420805394892@g.us",
  "120363418168443320@g.us",
  "120363426664187889@g.us",
  "120363409064832008@g.us",
  "120363405923643530@g.us",
  "120363176089818281@g.us",
  "120363272312108397@g.us",
  "120363422514509383@g.us",
  "120363304586013963@g.us",
  "120363425601990856@g.us",
  "120363408122221974@g.us",
]);

function stripPriceFromText(text: string): string {
  if (!text) return "";
  return text
    .replace(/(?:\bprice\b|\basking\b|\bcost\b|\bgoing for\b|\bselling for\b|\blast price\b|\bfor\b|\bat\b|\bonly\b|\beach\b)\s*[:=#-]?\s*(?:₦|NGN|Naira|N)?\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(?:k|m|thousand|million))?/gi, "")
    .replace(/(?:₦|\bngn\b|\bnaira\b|\bN(?=\s*\d))\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*(?:k|m|thousand|million))?/gi, "")
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, "")
    // Remove "Price: 350k", "Cost: ₦50,000", "Going for 1.5m", "last price 25k", etc.
    .replace(/(?:\bprice\b|\basking\b|\bcost\b|\bgoing for\b|\bselling for\b|\blast price\b)\s*[:=-]?\s*(?:₦|NGN)?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/gi, "")
    // Remove remaining price phrases like "last price", "asking price"
    .replace(/\b(?:last|asking)\s+price\b/gi, "")
    // Remove Naira symbols and following numbers e.g. ₦50,000, ₦ 350k
    .replace(/₦\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/gi, "")
    // Remove NGN numbers e.g. NGN 50,000
    .replace(/\bngn\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/gi, "")
    // Remove standalone shorthand e.g. 350k, 45k, 1.5m, 2.5M
    .replace(/(^|\s)\d+(?:[.,]\d+)?\s*[kKmM]\b/gi, "$1")
    // Remove standalone amounts with 4-9 digits if preceded by sale words
    .replace(/(?:\bfor\b|\bat\b|\b#)\s*[\d,]{4,10}\b/gi, "")
    // Clean up repetitive or orphaned punctuation
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([.,;:!?-])\s*([.,;:!?-])+/g, "$1")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/^\s*[,:;-]\s*/gm, "")
    .replace(/\s*[,:;-]\s*$/gm, "")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function value(value: unknown, max = 0) {
  const text = typeof value === "string" ? value.trim() : "";
  return max ? text.slice(0, max) : text;
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function validGroupJid(input: unknown) {
  return /^[0-9-]{10,80}@g\.us$/.test(value(input, 100));
}

function configuredAdminEmails() {
  return String(Deno.env.get("WHATSAPP_ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * This function is deployed without Supabase's global JWT verification because
 * ingestion and seller management use their own high-entropy credentials.
 * Dashboard actions therefore verify the caller's user JWT explicitly before
 * using the service client.
 */
async function requireDashboardAdmin(admin: ReturnType<typeof createClient>, req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return null;

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  const user = authData?.user;
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,accounts")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error("Could not verify the administrator account.");

  const role = value(profile?.role, 40).toLowerCase();
  const accountType = value(profile?.accounts, 40).toLowerCase();
  const email = value(user.email, 320).toLowerCase();
  const isTrustedRole = role === "admin" || role === "super_admin" || accountType === "admin";
  if (!isTrustedRole && !configuredAdminEmails().includes(email)) return null;
  return { id: user.id, email };
}

function safeUrl(input: unknown, expectedCloudName = "") {
  const text = value(input, 2_000);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    if (expectedCloudName && url.hostname !== "res.cloudinary.com") return "";
    if (expectedCloudName && !url.pathname.startsWith(`/${expectedCloudName}/`)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function requireCollectorSecret(req: Request) {
  const ingestSecret = Deno.env.get("WHATSAPP_INGEST_SECRET") || "";
  return Boolean(ingestSecret && req.headers.get("x-whatsapp-ingest-secret") === ingestSecret);
}

function queuePayload(input: unknown, cloudName: string) {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawMedia = Array.isArray(raw.media) ? raw.media : [];
  const media = rawMedia.slice(0, 30).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const type = value(row.type, 10) === "video" ? "video" : "image";
    const url = safeUrl(row.url, cloudName);
    const visionUrls = (Array.isArray(row.vision_urls) ? row.vision_urls : [])
      .slice(0, 6)
      .map((url) => safeUrl(url, cloudName))
      .filter(Boolean);
    return { url, type, vision_urls: visionUrls };
  }).filter((item) => item.url);

  return {
    text: value(raw.text, 12_000),
    audio_transcript: value(raw.audio_transcript, 12_000),
    media,
  };
}

function queueResult(input: unknown) {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const itemCount = finiteNumber(raw.item_count);
  return {
    message: value(raw.message, 1_000),
    item_count: itemCount === null ? 0 : Math.max(0, Math.min(Math.floor(itemCount), 100)),
  };
}

async function collectorGroupIsApproved(admin: ReturnType<typeof createClient>, groupJid: string) {
  if (LEGACY_LISTED_GROUPS.has(groupJid)) return true;
  const { data, error } = await admin
    .from("whatsapp_group_settings")
    .select("id")
    .eq("group_jid", groupJid)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("Could not verify the WhatsApp group configuration.");
  return Boolean(data);
}

async function queueListingJob(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  if (!requireCollectorSecret(req)) return json({ error: "Unauthorized ingestion queue request." }, 401);

  const groupJid = value(body.group_jid, 200);
  const senderJid = value(body.sender_jid, 200);
  const senderPhone = value(body.sender_phone, 30) || null;
  const dedupeKey = value(body.dedupe_key, 300);
  const rawMessageIds = Array.isArray(body.message_ids) ? body.message_ids : [];
  const messageIds = [...new Set(rawMessageIds.map((id) => value(id, 300)).filter(Boolean))].slice(0, 100);
  const cloudName = value(Deno.env.get("CLOUDINARY_CLOUD_NAME"), 120) || "tlulgsk1";
  const payload = queuePayload(body.payload, cloudName);

  if (!validGroupJid(groupJid) || !senderJid || dedupeKey.length < 16 || messageIds.length === 0) {
    return json({ error: "Queue source, sender, group, and message identifiers are required." }, 400);
  }
  if (!(await collectorGroupIsApproved(admin, groupJid))) {
    return json({ error: "This WhatsApp group is not approved for BUYSELL imports." }, 403);
  }

  const { data: existing, error: existingError } = await admin
    .from("whatsapp_ingestion_jobs")
    .select("id,state")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existingError) throw new Error("Could not check the incoming queue job.");

  const write = {
    group_jid: groupJid,
    sender_jid: senderJid,
    sender_phone: senderPhone,
    message_ids: messageIds,
    payload,
    state: "queued",
    available_at: new Date().toISOString(),
    lease_until: null,
    lock_token: null,
    locked_by: null,
    last_error: null,
  };

  if (existing) {
    if (existing.state === "completed") {
      return json({ queued: false, duplicate: true, job_id: existing.id, state: existing.state });
    }
    const { data, error } = await admin
      .from("whatsapp_ingestion_jobs")
      .update(write)
      .eq("id", existing.id)
      .select("id,state")
      .single();
    if (error || !data) throw new Error(error?.message || "Could not refresh the queued WhatsApp post.");
    return json({ queued: true, updated: true, job_id: data.id, state: data.state });
  }

  const { data, error } = await admin
    .from("whatsapp_ingestion_jobs")
    .insert({ ...write, dedupe_key: dedupeKey })
    .select("id,state")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not queue the WhatsApp post.");
  return json({ queued: true, job_id: data.id, state: data.state });
}

async function claimListingJobs(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  if (!requireCollectorSecret(req)) return json({ error: "Unauthorized ingestion queue request." }, 401);
  const workerId = value(body.worker_id, 120);
  const limit = Math.max(1, Math.min(Math.floor(finiteNumber(body.limit) || 1), 5));
  const leaseSeconds = Math.max(60, Math.min(Math.floor(finiteNumber(body.lease_seconds) || 900), 3600));
  const { data, error } = await admin.rpc("claim_whatsapp_ingestion_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(error.message || "Could not claim WhatsApp queue jobs.");
  const jobs = (Array.isArray(data) ? data : []).map((j: Record<string, unknown>) => ({
    id: j.id,
    dedupe_key: j.dedupe_key,
    group_jid: j.group_jid,
    sender_jid: j.sender_jid,
    message_ids: j.message_ids,
    payload: j.payload,
    lock_token: j.lock_token,
    attempts: j.attempts,
    max_attempts: j.max_attempts,
  }));
  return json({ jobs });
}

async function finishListingJob(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  if (!requireCollectorSecret(req)) return json({ error: "Unauthorized ingestion queue request." }, 401);
  const jobId = value(body.job_id, 80);
  const lockToken = value(body.lock_token, 80);
  const state = value(body.state, 30);
  if (!jobId || !lockToken || !["completed", "needs_price", "retry", "failed"].includes(state)) {
    return json({ error: "A claimed job and valid completion state are required." }, 400);
  }

  const retryInSeconds = Math.max(30, Math.min(Math.floor(finiteNumber(body.retry_in_seconds) || 60), 86_400));
  const update: Record<string, unknown> = {
    state,
    lease_until: null,
    lock_token: null,
    locked_by: null,
    last_error: state === "retry" || state === "failed" ? value(body.error, 2_000) || "The listing worker could not finish this job." : null,
    result: queueResult(body.result),
  };
  if (state === "retry") {
    update.available_at = new Date(Date.now() + retryInSeconds * 1_000).toISOString();
  }

  const { data, error } = await admin
    .from("whatsapp_ingestion_jobs")
    .update(update)
    .eq("id", jobId)
    .eq("lock_token", lockToken)
    .eq("state", "processing")
    .select("id,state,attempts,max_attempts")
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not finish the WhatsApp queue job.");
  if (!data) return json({ error: "This job lease has expired or was replaced by a newer post." }, 409);
  return json({ job: data });
}

// Bot 2's WhatsApp session (Baileys auth state). Values arrive already
// encrypted by the collector; this function only stores opaque ciphertext.
function authSessionId(input: unknown) {
  const id = value(input, 64);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
}

function authKey(input: unknown) {
  const key = typeof input === "string" ? input : "";
  return key.length >= 1 && key.length <= 400 && !/[\u0000-\u001f]/.test(key) ? key : "";
}

async function authStateAction(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>, action: string) {
  if (!requireCollectorSecret(req)) return json({ error: "Unauthorized session store request." }, 401);
  const sessionId = authSessionId(body.session_id);
  if (!sessionId) return json({ error: "A valid session_id is required." }, 400);

  if (action === "auth_state_get") {
    const rawKeys = Array.isArray(body.keys) ? body.keys : [];
    const keys = [...new Set(rawKeys.map(authKey).filter(Boolean))];
    if (keys.length === 0 || keys.length > 200 || keys.length !== rawKeys.length) {
      return json({ error: "Between 1 and 200 valid keys are required." }, 400);
    }
    const { data, error } = await admin
      .from("whatsapp_auth_state")
      .select("key,value")
      .eq("session_id", sessionId)
      .in("key", keys);
    if (error) throw new Error("Could not load the WhatsApp session.");
    return json({ values: Object.fromEntries((data || []).map((row) => [row.key, row.value])) });
  }

  if (action === "auth_state_set") {
    const rawEntries = Array.isArray(body.entries) ? body.entries : [];
    if (rawEntries.length === 0 || rawEntries.length > 100) return json({ error: "Between 1 and 100 entries are required." }, 400);
    const upserts = new Map<string, string>();
    const deletes = new Set<string>();
    for (const item of rawEntries) {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const key = authKey(row.key);
      if (!key) return json({ error: "Every entry needs a valid key." }, 400);
      if (row.value === null) {
        upserts.delete(key);
        deletes.add(key);
      } else if (typeof row.value === "string" && row.value.length > 0 && row.value.length <= 1_048_576) {
        deletes.delete(key);
        upserts.set(key, row.value);
      } else {
        return json({ error: "Entry values must be encrypted strings or null." }, 400);
      }
    }
    if (upserts.size) {
      const now = new Date().toISOString();
      const { error } = await admin.from("whatsapp_auth_state").upsert(
        [...upserts].map(([key, stored]) => ({ session_id: sessionId, key, value: stored, updated_at: now })),
        { onConflict: "session_id,key" },
      );
      if (error) throw new Error("Could not save the WhatsApp session.");
    }
    if (deletes.size) {
      const { error } = await admin
        .from("whatsapp_auth_state")
        .delete()
        .eq("session_id", sessionId)
        .in("key", [...deletes]);
      if (error) throw new Error("Could not update the WhatsApp session.");
    }
    return json({ saved: upserts.size, removed: deletes.size });
  }

  const { error } = await admin.from("whatsapp_auth_state").delete().eq("session_id", sessionId);
  if (error) throw new Error("Could not clear the WhatsApp session.");
  return json({ cleared: true });
}

function nativeCategory(input: unknown) {
  const raw = value(input, 80).toLowerCase();
  const aliases: Record<string, string> = {
    "phones & tablets": "phones",
    "computers & laptops": "electronics",
    vehicles: "other",
    "home & furniture": "home",
    "beauty & health": "beauty",
    services: "other",
  };
  const mapped = aliases[raw] || raw;
  return NATIVE_CATEGORIES.has(mapped) ? mapped : "other";
}

function nativeCondition(_input?: unknown) {
  // All products ingested via the WhatsApp bot are marked as brand new
  return "new";
}

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function listingState(meta: Record<string, unknown>, product: Record<string, unknown>) {
  if (meta.deleted_at) return "deleted";
  if (meta.sold_at || Number(product.stock_quantity) === 0) return "sold";
  return product.status === "active" ? "live" : "pending";
}

function productResponse(product: Record<string, unknown>, meta: Record<string, unknown>) {
  return {
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      category: product.category,
      condition: product.condition,
      location: product.location,
      status: product.status,
      stock_quantity: product.stock_quantity,
      negotiable: product.negotiable,
      image_url: product.image_url,
    },
    listing_state: listingState(meta, product),
  };
}

async function managedListing(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const productId = value(body.product_id, 80);
  const token = value(body.manage_token, 200);
  if (!productId || !token) throw new Error("This management link is incomplete.");

  const hash = await sha256(token);
  const { data: meta, error: metaError } = await admin
    .from("whatsapp_listing_meta")
    .select("product_id,sold_at,deleted_at")
    .eq("product_id", productId)
    .eq("manage_token_hash", hash)
    .maybeSingle();
  if (metaError) throw new Error("Could not verify this management link.");
  if (!meta) return null;

  const { data: product, error: productError } = await admin
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", productId)
    .maybeSingle();
  if (productError) throw new Error("Could not load this listing.");
  if (!product) return null;
  return { meta, product };
}

async function ingest(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  const ingestSecret = Deno.env.get("WHATSAPP_INGEST_SECRET") || "";
  if (!ingestSecret || req.headers.get("x-whatsapp-ingest-secret") !== ingestSecret) {
    return json({ error: "Unauthorized ingestion request." }, 401);
  }

  const sellerId = value(Deno.env.get("WHATSAPP_LISTINGS_SELLER_ID"), 80)
    || value(body.seller_id, 80)
    || "e525b6d9-4f81-4522-822d-119151671dba";
  if (!sellerId) return json({ error: "WHATSAPP_LISTINGS_SELLER_ID is not configured." }, 500);

  const sourceMessageId = value(body.source_message_id, 300);
  const manageToken = value(body.manage_token, 200);
  const groupJid = value(body.group_jid, 200);
  const senderJid = value(body.sender_jid, 200);
  const title = value(body.title, 300);
  const price = finiteNumber(body.price);
  if (!sourceMessageId || !manageToken || !groupJid || !senderJid || title.length < 3) {
    return json({ error: "Listing source, seller, management token, and title are required." }, 400);
  }
  if (price === null || price <= 0 || price > 99_995_000) {
    return json({ error: "A fixed source price between ₦1 and ₦99,995,000 is required for a marketplace listing." }, 400);
  }

  const { data: existing, error: existingError } = await admin
    .from("whatsapp_listing_meta")
    .select("product_id")
    .eq("source_message_id", sourceMessageId)
    .maybeSingle();
  if (existingError) throw new Error("Could not check the incoming message.");
  if (existing) return json({ created: false, product_id: existing.product_id });

  if (!validGroupJid(groupJid)) return json({ error: "The incoming WhatsApp group ID is invalid." }, 400);
  if (!(await collectorGroupIsApproved(admin, groupJid))) {
    return json({ error: "This WhatsApp group is not approved for BUYSELL imports." }, 403);
  }

  const cloudName = value(Deno.env.get("CLOUDINARY_CLOUD_NAME"), 120) || "tlulgsk1";
  const rawMedia = Array.isArray(body.media) ? body.media : [];
  const media = rawMedia.slice(0, 30).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      url: safeUrl(row.url, cloudName),
      type: value(row.type, 10) === "video" ? "video" : "image",
    };
  }).filter((item) => item.url);
  const images = media.filter((item) => item.type === "image").map((item) => item.url);
  const videos = media.filter((item) => item.type === "video").map((item) => item.url);
  const rawDescription = value(body.description, 2_000);
  const description = stripPriceFromText(rawDescription);
  const brand = value(body.brand, 80);
  const rawSpecs = value(body.specs, 500);
  const specs = stripPriceFromText(rawSpecs);
  const detailLines = [description, brand ? `Brand: ${brand}` : "", specs ? `Details: ${specs}` : ""].filter(Boolean);
  const shippingFee = Math.max(0, finiteNumber(Deno.env.get("WHATSAPP_LISTING_SHIPPING_FEE")) ?? 2_500);

  // Bot 2 writes straight to the public products table instead of going
  // through manage-product. Its amount below is therefore already the final
  // buyer price and must receive this one 20% commission only once.
  const markupPercent = WHATSAPP_PRICE_MARKUP_PERCENT;
  const priceMarkup = Math.round((price * markupPercent) / 100);
  const marketplacePrice = price + priceMarkup;
  const productPayload = {
    seller_id: sellerId,
    name: title,
    description: detailLines.join("\n\n").slice(0, 2_000),
    price: marketplacePrice,
    // The source price is private metadata. Showing it as a crossed-out
    // marketplace price would imply a discount that does not exist.
    original_price: marketplacePrice,
    shipping_fee: shippingFee,
    shipping_cost: shippingFee,
    category: nativeCategory(body.category),
    condition: "new",
    location: value(body.location, 100),
    images,
    videos,
    image_url: images[0] || null,
    video_url: videos[0] || null,
    has_video: videos.length > 0,
    stock_quantity: Math.max(1, finiteNumber(body.stock_quantity) || 1),
    negotiable: body.negotiable === true,
    // Imported listings are not public until a BUYSELL admin reviews them.
    status: "pending",
  };

  const { data: product, error: productError } = await admin
    .from("products")
    .insert(productPayload)
    .select("id,name,price,status")
    .single();
  if (productError || !product) throw new Error(productError?.message || "Could not create the marketplace product.");

  const { error: metaError } = await admin.from("whatsapp_listing_meta").insert({
    product_id: product.id,
    source_message_id: sourceMessageId,
    group_jid: groupJid,
    sender_jid: senderJid,
    sender_phone: value(body.sender_phone, 30) || null,
    manage_token_hash: await sha256(manageToken),
    source_price: price,
    price_markup: priceMarkup,
  });
  if (metaError) {
    // The source-message unique index handles reconnect/replay races. Remove
    // the just-created product so it cannot become an orphaned duplicate.
    await admin.from("products").delete().eq("id", product.id);
    if (metaError.code === "23505") {
      const { data: duplicate } = await admin
        .from("whatsapp_listing_meta")
        .select("product_id")
        .eq("source_message_id", sourceMessageId)
        .maybeSingle();
      return json({ created: false, product_id: duplicate?.product_id || null });
    }
    throw new Error(metaError.message || "Could not secure the seller management link.");
  }

  // This is intentionally stored separately from the public marketplace price.
  // BOGO and seller payouts must be based on the exact verified WhatsApp source
  // price, which must never be exposed through the public products query.
  const { error: sellerPriceError } = await admin.from("product_seller_pricing").upsert({
    product_id: product.id,
    seller_price: price,
    source: "whatsapp_verified",
    recorded_by: null,
  }, { onConflict: "product_id" });
  if (sellerPriceError) {
    // product deletion cascades to the private WhatsApp metadata row, so a
    // retry never leaves a public listing without an authoritative base price.
    await admin.from("products").delete().eq("id", product.id);
    throw new Error(sellerPriceError.message || "Could not save the verified seller price.");
  }

  const siteUrl = value(Deno.env.get("PUBLIC_SITE_URL"), 500).replace(/\/+$/, "");
  return json({
    created: true,
    product_id: product.id,
    product,
    public_url: siteUrl ? `${siteUrl}/product?id=${encodeURIComponent(product.id)}` : "",
  });
}

async function sellerCommand(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  const ingestSecret = Deno.env.get("WHATSAPP_INGEST_SECRET") || "";
  if (!ingestSecret || req.headers.get("x-whatsapp-ingest-secret") !== ingestSecret) {
    return json({ error: "Unauthorized seller command." }, 401);
  }
  const senderJid = value(body.sender_jid, 200);
  const command = value(body.command, 20).toUpperCase();
  if (!senderJid || !["SOLD", "DELETE"].includes(command)) return json({ error: "Unsupported seller command." }, 400);

  const { data: rows, error } = await admin
    .from("whatsapp_listing_meta")
    .select("product_id")
    .eq("sender_jid", senderJid)
    .is("sold_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error("Could not find the seller's listing.");
  const productId = rows?.[0]?.product_id;
  if (!productId) return json({ found: false });

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id,name")
    .eq("id", productId)
    .maybeSingle();
  if (productError || !product) return json({ found: false });

  const productUpdate = command === "SOLD" ? { status: "paused", stock_quantity: 0 } : { status: "paused" };
  const { error: updateError } = await admin.from("products").update(productUpdate).eq("id", productId);
  if (updateError) throw new Error("Could not update the marketplace listing.");
  const timeField = command === "SOLD" ? { sold_at: new Date().toISOString() } : { deleted_at: new Date().toISOString() };
  const { error: metaUpdateError } = await admin.from("whatsapp_listing_meta").update(timeField).eq("product_id", productId);
  if (metaUpdateError) throw new Error("Could not record the seller command.");
  return json({ found: true, product: { id: product.id, name: product.name }, command });
}

async function manageUpdate(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const listing = await managedListing(admin, body);
  if (!listing) return json({ error: "This management link is invalid or has expired." }, 404);
  if (listing.meta.deleted_at) return json({ error: "This listing has already been removed." }, 410);

  const mode = value(body.mode, 20);
  if (mode === "sold" || mode === "delete") {
    const productUpdate = mode === "sold" ? { status: "paused", stock_quantity: 0 } : { status: "paused" };
    const { error: productError } = await admin.from("products").update(productUpdate).eq("id", listing.product.id);
    if (productError) throw new Error("Could not update this listing.");
    const metaUpdate = mode === "sold" ? { sold_at: new Date().toISOString() } : { deleted_at: new Date().toISOString() };
    const { error: metaError } = await admin.from("whatsapp_listing_meta").update(metaUpdate).eq("product_id", listing.product.id);
    if (metaError) throw new Error("Could not update this listing.");
  } else {
    if (listing.meta.sold_at) return json({ error: "Sold listings cannot be edited." }, 409);
    const updates = body.updates && typeof body.updates === "object" ? body.updates as Record<string, unknown> : {};
    const patch: Record<string, unknown> = {};
    if ("title" in updates) {
      const title = value(updates.title, 300);
      if (title.length < 3) return json({ error: "Title must be at least 3 characters." }, 400);
      patch.name = title;
    }
    if ("description" in updates) patch.description = value(updates.description, 2_000);
    if ("location" in updates) patch.location = value(updates.location, 100);
    if ("category" in updates) patch.category = nativeCategory(updates.category);
    if ("condition" in updates) patch.condition = nativeCondition(updates.condition);
    let revisedSourcePrice: number | null = null;
    let revisedPriceMarkup = 0;
    if ("price" in updates) {
      const price = finiteNumber(updates.price);
      if (price === null || price <= 0 || price > 100_000_000) return json({ error: "Enter a valid price in naira." }, 400);
      // The management page edits the seller/source price. Keep Bot 2 at its
      // existing single 20% markup instead of treating this public listing as
      // a regular seller-dashboard submission (which would add it again).
      revisedSourcePrice = price;
      revisedPriceMarkup = Math.round((price * WHATSAPP_PRICE_MARKUP_PERCENT) / 100);
      patch.price = price + revisedPriceMarkup;
      patch.original_price = patch.price;
    }
    if (!Object.keys(patch).length) return json({ error: "No valid changes were provided." }, 400);
    const { error } = await admin.from("products").update(patch).eq("id", listing.product.id);
    if (error) throw new Error("Could not save your changes.");
    if (revisedSourcePrice !== null) {
      const { error: sellerPriceError } = await admin.from("product_seller_pricing").upsert({
        product_id: listing.product.id,
        seller_price: revisedSourcePrice,
        source: "whatsapp_verified",
        recorded_by: null,
      }, { onConflict: "product_id" });
      if (sellerPriceError) throw new Error("Could not save the verified seller price.");
      const { error: metaError } = await admin.from("whatsapp_listing_meta").update({
        source_price: revisedSourcePrice,
        price_markup: revisedPriceMarkup,
      }).eq("product_id", listing.product.id);
      if (metaError) throw new Error("Could not save the WhatsApp price details.");
    }
  }

  const refreshed = await managedListing(admin, body);
  if (!refreshed) throw new Error("Could not reload this listing.");
  return json(productResponse(refreshed.product, refreshed.meta));
}

async function approvedGroupsForCollector(admin: ReturnType<typeof createClient>, req: Request) {
  const ingestSecret = Deno.env.get("WHATSAPP_INGEST_SECRET") || "";
  if (!ingestSecret || req.headers.get("x-whatsapp-ingest-secret") !== ingestSecret) {
    return json({ error: "Unauthorized group configuration request." }, 401);
  }
  const { data, error } = await admin
    .from("whatsapp_group_settings")
    .select("group_jid")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error("Could not load approved WhatsApp groups.");
  return json({ groups: (data || []).map((row) => row.group_jid) });
}

async function adminDashboardAction(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  const administrator = await requireDashboardAdmin(admin, req);
  if (!administrator) return json({ error: "Administrator access is required." }, 403);

  const command = value(body.command, 40);
  if (command === "list_groups") {
    const { data, error } = await admin
      .from("whatsapp_group_settings")
      .select("id,group_jid,display_name,is_active,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load WhatsApp groups.");
    return json({ groups: data || [] });
  }

  if (command === "add_group") {
    const groupJid = value(body.group_jid, 100);
    const displayName = value(body.display_name, 120);
    if (!validGroupJid(groupJid)) {
      return json({ error: "Enter a valid WhatsApp group ID ending in @g.us." }, 400);
    }
    const { data, error } = await admin
      .from("whatsapp_group_settings")
      .insert({ group_jid: groupJid, display_name: displayName, created_by: administrator.id })
      .select("id,group_jid,display_name,is_active,created_at,updated_at")
      .single();
    if (error?.code === "23505") return json({ error: "This WhatsApp group is already configured." }, 409);
    if (error) throw new Error(error.message || "Could not save this WhatsApp group.");
    return json({ group: data }, 201);
  }

  if (command === "set_group_active") {
    const groupId = value(body.group_id, 80);
    if (!groupId) return json({ error: "A group ID is required." }, 400);
    const { data, error } = await admin
      .from("whatsapp_group_settings")
      .update({ is_active: body.is_active === true })
      .eq("id", groupId)
      .select("id,group_jid,display_name,is_active,created_at,updated_at")
      .maybeSingle();
    if (error) throw new Error("Could not update this WhatsApp group.");
    if (!data) return json({ error: "WhatsApp group not found." }, 404);
    return json({ group: data });
  }

  if (command === "delete_group") {
    const groupId = value(body.group_id, 80);
    if (!groupId) return json({ error: "A group ID is required." }, 400);
    const { error } = await admin.from("whatsapp_group_settings").delete().eq("id", groupId);
    if (error) throw new Error("Could not remove this WhatsApp group.");
    return json({ removed: true });
  }

  if (command === "list_listings") {
    const { data, error } = await admin
      .from("whatsapp_listing_meta")
      .select("product_id,group_jid,source_price,price_markup,sold_at,deleted_at,created_at,products(id,name,price,category,condition,location,status,stock_quantity,image_url)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Could not load WhatsApp listings.");
    const listings = (data || []).map((row) => ({
      product_id: row.product_id,
      group_jid: row.group_jid,
      source_price: row.source_price,
      price_markup: row.price_markup,
      sold_at: row.sold_at,
      deleted_at: row.deleted_at,
      created_at: row.created_at,
      product: Array.isArray(row.products) ? row.products[0] || null : row.products || null,
    }));
    return json({ listings });
  }

  if (command === "update_listing") {
    const productId = value(body.product_id, 80);
    const mode = value(body.mode, 20);
    if (!productId || !["activate", "pause", "remove"].includes(mode)) {
      return json({ error: "A valid listing action is required." }, 400);
    }

    const { data: meta, error: metaError } = await admin
      .from("whatsapp_listing_meta")
      .select("product_id,sold_at,deleted_at")
      .eq("product_id", productId)
      .maybeSingle();
    if (metaError) throw new Error("Could not find this WhatsApp listing.");
    if (!meta) return json({ error: "WhatsApp listing not found." }, 404);
    if (mode === "activate" && (meta.sold_at || meta.deleted_at)) {
      return json({ error: "Sold or removed listings cannot be reactivated." }, 409);
    }

    const productPatch = mode === "activate"
      ? { status: "active", stock_quantity: 1, condition: "new" }
      : { status: "paused" };
    const { error: productError } = await admin.from("products").update(productPatch).eq("id", productId);
    if (productError) throw new Error("Could not update the marketplace product.");

    if (mode === "remove") {
      const { error: removeError } = await admin
        .from("whatsapp_listing_meta")
        .update({ deleted_at: new Date().toISOString() })
        .eq("product_id", productId);
      if (removeError) throw new Error("Could not mark the WhatsApp listing as removed.");
    }
    return json({ updated: true, mode });
  }

  return json({ error: "Unknown administrator action." }, 400);
}

async function orderWhatsAppSales(admin: ReturnType<typeof createClient>, req: Request, _body: Record<string, unknown>) {
  const ingestSecret = Deno.env.get("WHATSAPP_INGEST_SECRET") || "";
  if (!ingestSecret || req.headers.get("x-whatsapp-ingest-secret") !== ingestSecret) {
    return json({ error: "Unauthorized." }, 401);
  }

  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id,items,total_amount,status,delivery_name,delivery_phone,delivery_address,created_at")
    .in("status", ["confirmed", "delivered", "shipped"])
    .order("created_at", { ascending: false })
    .limit(30);

  if (ordersError) throw new Error("Could not load orders.");

  const allProductIds = new Set<string>();
  (orders || []).forEach((order: any) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    items.forEach((item: any) => {
      const pid = String(item?.id || item?.product_id || "");
      if (pid) allProductIds.add(pid);
    });
  });

  if (allProductIds.size === 0) return json({ sales: [] });

  const { data: metaList, error: metaError } = await admin
    .from("whatsapp_listing_meta")
    .select("product_id,group_jid,sender_jid,sender_phone,source_price,created_at")
    .in("product_id", Array.from(allProductIds));

  if (metaError || !metaList || metaList.length === 0) return json({ sales: [] });

  const metaMap = new Map((metaList as any[]).map((m: any) => [m.product_id, m]));
  const groupJids = Array.from(new Set((metaList as any[]).map((m: any) => m.group_jid)));
  const { data: groupSettings } = await admin
    .from("whatsapp_group_settings")
    .select("group_jid,display_name")
    .in("group_jid", groupJids);

  const groupNameMap = new Map((groupSettings || []).map((g: any) => [g.group_jid, g.display_name]));

  const sales: Array<Record<string, unknown>> = [];
  (orders || []).forEach((order: any) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    items.forEach((item: any) => {
      const pid = String(item?.id || item?.product_id || "");
      const meta = metaMap.get(pid);
      if (meta) {
        sales.push({
          order_id: order.id,
          product_id: pid,
          product_name: item?.name || item?.title || "Marketplace Product",
          paid_price: item?.price || order.total_amount,
          group_jid: meta.group_jid,
          group_name: groupNameMap.get(meta.group_jid) || "WhatsApp Seller Group",
          seller_phone: meta.sender_phone || String(meta.sender_jid || "").split("@")[0] || "",
          source_price: meta.source_price,
          delivery_name: order.delivery_name || "Customer",
          delivery_phone: order.delivery_phone || "",
          delivery_address: order.delivery_address || "",
          order_created_at: order.created_at,
        });
      }
    });
  });

  return json({ sales });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase service configuration is missing.");
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = value(body.action, 40);
    const admin = createClient(supabaseUrl, serviceKey);

    if (action === "ingest") return await ingest(admin, req, body);
    if (action === "queue_enqueue") return await queueListingJob(admin, req, body);
    if (action === "queue_claim") return await claimListingJobs(admin, req, body);
    if (action === "queue_finish") return await finishListingJob(admin, req, body);
    if (action === "seller_command") return await sellerCommand(admin, req, body);
    if (action === "collector_groups") return await approvedGroupsForCollector(admin, req);
    if (action === "order_whatsapp_sales") return await orderWhatsAppSales(admin, req, body);
    if (action === "admin") return await adminDashboardAction(admin, req, body);
    if (action === "auth_state_get" || action === "auth_state_set" || action === "auth_state_clear") {
      return await authStateAction(admin, req, body, action);
    }
    if (action === "manage_get") {
      const listing = await managedListing(admin, body);
      return listing ? json(productResponse(listing.product, listing.meta)) : json({ error: "This management link is invalid or has expired." }, 404);
    }
    if (action === "manage_update") return await manageUpdate(admin, body);
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("whatsapp-listing-action error:", error);
    return json({ error: error instanceof Error ? error.message : "Could not process the WhatsApp listing request." }, 400);
  }
});
