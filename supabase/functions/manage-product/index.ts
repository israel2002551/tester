import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SELLER_ROLES = new Set(["seller", "admin", "both", "service_provider"]);
const ACTIVE_STATUSES = new Set(["active", "paused", "draft", "pending", "sold", "out_of_stock"]);
const VALID_CATEGORIES = new Set(["electronics", "fashion", "home", "phones", "beauty", "sports", "dropship", "other"]);
const VALID_CONDITIONS = new Set(["new", "used-like-new", "used-good"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanUrlArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item, 1500))
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 8);
}

function buildProductPayload(data: Record<string, unknown>, sellerId: string, isCreate: boolean) {
  const name = cleanString(data.name, 300);
  const description = cleanString(data.description, 2000);
  const category = cleanString(data.category, 40);
  const condition = cleanString(data.condition, 40);
  const price = cleanNumber(data.price);
  const originalPrice = Math.max(cleanNumber(data.original_price, price), price);
  const shippingFee = Math.max(0, cleanNumber(data.shipping_fee ?? data.shipping_cost, 0));
  const stock = Math.max(0, Math.min(100000, Math.trunc(cleanNumber(data.stock_quantity, 0))));
  const lowStockAlert = Math.max(0, Math.trunc(cleanNumber(data.low_stock_alert, 3)));
  const images = cleanUrlArray(data.images);
  const videos = cleanUrlArray(data.videos).slice(0, 3);

  if (isCreate || data.name !== undefined) {
    if (name.length < 3) throw new Error("Product name must be at least 3 characters.");
  }
  if (isCreate || data.price !== undefined) {
    if (price <= 0 || price > 100000000) throw new Error("Enter a valid product price.");
  }
  if (isCreate || data.category !== undefined) {
    if (!VALID_CATEGORIES.has(category)) throw new Error("Please select a valid category.");
  }
  if (isCreate || data.condition !== undefined) {
    if (!VALID_CONDITIONS.has(condition)) throw new Error("Please select a valid condition.");
  }

  const payload: Record<string, unknown> = {
    name,
    description,
    price,
    original_price: originalPrice,
    shipping_fee: shippingFee,
    shipping_cost: shippingFee,
    category,
    condition,
    location: cleanString(data.location, 100),
    negotiable: Boolean(data.negotiable),
    stock_quantity: stock,
    low_stock_alert: lowStockAlert,
    has_video: videos.length > 0 || Boolean(data.has_video),
  };

  if (isCreate) {
    payload.seller_id = sellerId;
    payload.status = ACTIVE_STATUSES.has(cleanString(data.status, 30)) ? cleanString(data.status, 30) : "active";
  }
  if (data.image_url !== undefined || images.length) payload.image_url = cleanString(data.image_url || images[0], 1500);
  if (data.video_url !== undefined || videos.length) payload.video_url = cleanString(data.video_url || videos[0], 1500);
  if (images.length) payload.images = images;
  if (videos.length) payload.videos = videos;

  return payload;
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
    .select("id,role,accounts,is_suspended")
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
    const { action, product_id, data = {} } = await req.json();
    await ensureSellerAccess(admin, user.id);

    if (action === "create") {
      const payload = buildProductPayload(data, user.id, true);
      const { data: product, error } = await admin.from("products").insert(payload).select("*").single();
      if (error) throw error;
      return json({ product, product_id: product.id });
    }

    if (!product_id) throw new Error("Product id is required.");
    const { data: product, error: lookupError } = await admin
      .from("products")
      .select("id,seller_id,status,stock_quantity")
      .eq("id", product_id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!product) throw new Error("Product not found.");
    if (product.seller_id !== user.id) throw new Error("You can only manage your own products.");

    if (action === "update") {
      const payload = buildProductPayload(data, user.id, false);
      const { data: updated, error } = await admin.from("products").update(payload).eq("id", product_id).select("*").single();
      if (error) throw error;
      return json({ product: updated, product_id: updated.id });
    }

    if (action === "toggle_status") {
      const next = product.status === "active" ? "paused" : "active";
      const { data: updated, error } = await admin.from("products").update({ status: next }).eq("id", product_id).select("*").single();
      if (error) throw error;
      return json({ product: updated, product_id: updated.id, status: next });
    }

    if (action === "delete") {
      const { error } = await admin.from("products").delete().eq("id", product_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unsupported product action." }, 400);
  } catch (error) {
    console.error("manage-product error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
