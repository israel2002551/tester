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
// This is deliberately server-owned. Browsers submit the seller's amount;
// only this function calculates the buyer-facing marketplace amount.
const PLATFORM_COMMISSION_PERCENT = 20;
const PLATFORM_COMMISSION_MULTIPLIER = 1 + (PLATFORM_COMMISSION_PERCENT / 100);
const MAX_BULK_PRODUCTS = 100;

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

function wholeNaira(value: unknown, fallback = 0) {
  const number = cleanNumber(value, fallback);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function buyerPriceForSellerPrice(sellerPrice: unknown) {
  return Math.round(wholeNaira(sellerPrice) * PLATFORM_COMMISSION_MULTIPLIER);
}

function sellerPriceForBuyerPrice(buyerPrice: unknown) {
  return Math.max(0, Math.round(wholeNaira(buyerPrice) / PLATFORM_COMMISSION_MULTIPLIER));
}

function cleanUrlArray(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item, 1500))
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, limit);
}

function hasOwn(data: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function buildProductPayload(data: Record<string, unknown>, sellerId: string, isCreate: boolean) {
  const name = cleanString(data.name, 300);
  const description = cleanString(data.description, 2000);
  const category = cleanString(data.category, 40);
  const condition = cleanString(data.condition, 40);
  // `data.price` and `data.original_price` are the amounts the seller enters.
  // The public products table stores only the price that a buyer pays, while
  // the private product_seller_pricing table keeps the exact seller amount for
  // payouts and BOGO calculations.
  const sellerPrice = wholeNaira(data.price);
  const sellerOriginalPrice = Math.max(wholeNaira(data.original_price, sellerPrice), sellerPrice);
  const price = buyerPriceForSellerPrice(sellerPrice);
  const originalPrice = Math.max(buyerPriceForSellerPrice(sellerOriginalPrice), price);
  const shippingFee = Math.max(0, cleanNumber(data.shipping_fee ?? data.shipping_cost, 0));
  const stock = Math.max(0, Math.min(100000, Math.trunc(cleanNumber(data.stock_quantity, 0))));
  const lowStockAlert = Math.max(0, Math.trunc(cleanNumber(data.low_stock_alert, 3)));
  const images = cleanUrlArray(data.images);
  const videos = cleanUrlArray(data.videos, 3);
  const includesImages = hasOwn(data, "images");
  const includesVideos = hasOwn(data, "videos");

  if (isCreate || data.name !== undefined) {
    if (name.length < 3) throw new Error("Product name must be at least 3 characters.");
  }
  if (isCreate || data.price !== undefined) {
    if (sellerPrice <= 0 || sellerPrice > 100000000) throw new Error("Enter a valid seller product price.");
  }
  if (isCreate || data.category !== undefined) {
    if (!VALID_CATEGORIES.has(category)) throw new Error("Please select a valid product category.");
  }
  if (isCreate || data.condition !== undefined) {
    if (!VALID_CONDITIONS.has(condition)) throw new Error("Please select a valid product condition.");
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
  if (data.image_url !== undefined || includesImages) {
    payload.image_url = cleanString(data.image_url ?? images[0], 1500);
  }
  if (data.video_url !== undefined || includesVideos) {
    payload.video_url = cleanString(data.video_url ?? videos[0], 1500);
  }
  if (includesImages) payload.images = images;
  if (includesVideos) payload.videos = videos;

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

async function ensureSellerAccess(admin: ReturnType<typeof createClient>, userId: string) {
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

/**
 * Keep the seller's base price in the private pricing table. Public product
 * rows remain safe to expose to marketplace clients while checkout can still
 * calculate commission-funded promotions from an authoritative seller price.
 */
async function upsertSellerPrice(
  admin: ReturnType<typeof createClient>,
  productId: string,
  sellerPrice: number,
  recordedBy: string,
) {
  const { error } = await admin.from("product_seller_pricing").upsert({
    product_id: productId,
    seller_price: sellerPrice,
    source: "seller_submission",
    recorded_by: recordedBy,
  }, { onConflict: "product_id" });
  if (error) throw error;
}

async function createProducts(
  admin: ReturnType<typeof createClient>,
  rawProducts: Record<string, unknown>[],
  sellerId: string,
) {
  if (!rawProducts.length) throw new Error("At least one product is required.");
  if (rawProducts.length > MAX_BULK_PRODUCTS) {
    throw new Error(`You can upload up to ${MAX_BULK_PRODUCTS} products at once.`);
  }

  // Validate every row before writing anything so an invalid CSV row cannot
  // leave the seller with a partially imported batch.
  const rows = rawProducts.map((data) => ({
    payload: buildProductPayload(data, sellerId, true),
    sellerPrice: wholeNaira(data.price),
  }));
  const { data: products, error: productError } = await admin
    .from("products")
    .insert(rows.map((row) => row.payload))
    .select("*");
  if (productError || !products || products.length !== rows.length) {
    throw new Error(productError?.message || "Could not create the marketplace products.");
  }

  const { error: pricingError } = await admin.from("product_seller_pricing").upsert(
    products.map((product: Record<string, unknown>, index: number) => ({
      product_id: String(product.id),
      seller_price: rows[index].sellerPrice,
      source: "seller_submission",
      recorded_by: sellerId,
    })),
    { onConflict: "product_id" },
  );
  if (pricingError) {
    // A public product without its authoritative seller price would break
    // payouts and BOGO. Remove this just-created batch before reporting it.
    await admin.from("products").delete().in("id", products.map((product: Record<string, unknown>) => String(product.id)));
    throw new Error(pricingError.message || "Could not save seller pricing for the uploaded products.");
  }

  return products;
}

async function productForSeller(
  admin: ReturnType<typeof createClient>,
  productId: string,
  sellerId: string,
) {
  const { data: product, error: productError } = await admin
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("seller_id", sellerId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error("Product not found.");

  const { data: pricing, error: pricingError } = await admin
    .from("product_seller_pricing")
    .select("seller_price")
    .eq("product_id", productId)
    .maybeSingle();
  if (pricingError) throw pricingError;

  const sellerPrice = pricing?.seller_price === undefined || pricing?.seller_price === null
    ? null
    : wholeNaira(pricing.seller_price);
  const buyerPrice = wholeNaira(product.price);
  // New products have public price = seller price × 1.20. Older listings may
  // predate this rule, in which case their original price is already a seller
  // amount and must not be divided a second time when the edit form opens.
  const priceHasCommission = sellerPrice !== null && buyerPrice === buyerPriceForSellerPrice(sellerPrice);
  const sellerOriginalPrice = sellerPrice === null
    ? null
    : Math.max(
      sellerPrice,
      priceHasCommission
        ? sellerPriceForBuyerPrice(product.original_price ?? product.price)
        : wholeNaira(product.original_price ?? product.price, sellerPrice),
    );

  return {
    ...product,
    seller_price: sellerPrice,
    seller_original_price: sellerOriginalPrice,
  };
}

async function productsForSeller(
  admin: ReturnType<typeof createClient>,
  sellerId: string,
) {
  const { data: products, error: productsError } = await admin
    .from("products")
    .select("id,name,price,shipping_fee,shipping_cost,image_url,images,video_url,videos,has_video,stock_quantity,status,created_at")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (productsError) throw productsError;

  const productIds = (products || []).map((product: Record<string, unknown>) => String(product.id));
  if (!productIds.length) return [];
  const { data: prices, error: pricesError } = await admin
    .from("product_seller_pricing")
    .select("product_id,seller_price")
    .in("product_id", productIds);
  if (pricesError) throw pricesError;
  const sellerPriceById = new Map(
    (prices || []).map((price: Record<string, unknown>) => [String(price.product_id), wholeNaira(price.seller_price)]),
  );

  return products.map((product: Record<string, unknown>) => ({
    ...product,
    // This response is only returned to the authenticated owner after the
    // seller-role check above; do not expose this through public product APIs.
    seller_price: sellerPriceById.get(String(product.id)) ?? null,
  }));
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
    const { action, product_id, data = {}, products = [] } = await req.json();
    await ensureSellerAccess(admin, user.id);

    if (action === "create") {
      const [product] = await createProducts(admin, [data], user.id);
      return json({ product, product_id: product.id });
    }

    if (action === "bulk_create") {
      if (!Array.isArray(products)) throw new Error("Products must be an array.");
      const inputRows = products.map((product) => product && typeof product === "object" ? product as Record<string, unknown> : {});
      const created = await createProducts(admin, inputRows, user.id);
      return json({ products: created, product_ids: created.map((product: Record<string, unknown>) => product.id), count: created.length });
    }

    if (action === "list") {
      const sellerProducts = await productsForSeller(admin, user.id);
      return json({ products: sellerProducts, count: sellerProducts.length });
    }

    if (!product_id) throw new Error("Product id is required.");
    const { data: product, error: lookupError } = await admin
      .from("products")
      .select("id,seller_id,status")
      .eq("id", product_id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!product) throw new Error("Product not found.");
    if (product.seller_id !== user.id) throw new Error("You can only manage your own products.");

    if (action === "get") {
      const fullProduct = await productForSeller(admin, String(product_id), user.id);
      return json({ product: fullProduct, product_id: fullProduct.id });
    }

    if (action === "update") {
      const payload = buildProductPayload(data, user.id, false);
      const { data: updated, error } = await admin.from("products").update(payload).eq("id", product_id).select("*").single();
      if (error) throw error;
      if (data.price !== undefined) {
        await upsertSellerPrice(admin, updated.id, wholeNaira(data.price), user.id);
      }
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
