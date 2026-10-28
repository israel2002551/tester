import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * This pricing module deliberately stays in this function's source file.
 * Some dashboard-based Edge Function deploys upload index.ts alone, so a
 * parent-directory import (../_shared/bogo.ts) would be missing at bundle
 * time. Keeping the trusted pricing primitives here makes this function
 * deployable from both the CLI and the Supabase Dashboard.
 */
const CUSTOMER_MARKUP_BPS = 2_000; // 20.00%
const BPS_DENOMINATOR = 10_000;

type BogoSettings = {
  bogo_promo_enabled: boolean;
  bogo_profit_share_percent: number;
  bogo_min_order_value: number;
  free_shipping_promo_enabled: boolean;
  free_shipping_mode: "FULL_THRESHOLD" | "PERCENTAGE_CAP" | "HYBRID";
  free_shipping_profit_share_percent: number;
  free_shipping_min_order_value: number;
  allow_promo_stacking: boolean;
};

type ShippingGroup = { seller_name: string; fee: number };

type SellerPricedItem = {
  id: string;
  seller_id: string | null;
  seller_price: number;
  qty: number;
  name?: string;
  image_url?: string | null;
};

type BogoGift = Omit<SellerPricedItem, "qty">;

type BogoPricingInput = {
  paid_items: SellerPricedItem[];
  primary_item_id?: string | null;
  free_gift?: BogoGift | null;
  settings?: Partial<BogoSettings> | null;
  shipping_groups?: ShippingGroup[];
};

type BogoAllocation = {
  allocation_key: string;
  allocation_type: "paid_item" | "bogo_primary" | "bogo_gift";
  seller_id: string | null;
  product_id: string;
  seller_amount: number;
  customer_amount: number;
  platform_revenue_amount: number;
  platform_promo_discount_amount: number;
};

type LogisticsAllocation = {
  allocation_key: string;
  courier_amount: number;
  customer_shipping_amount: number;
  platform_shipping_subsidy: number;
};

function wholeNaira(value: unknown, fallback = 0) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : fallback;
}

function percentToBps(value: unknown, fallback = 1_000) {
  const percent = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(percent)) return fallback;
  return Math.max(0, Math.min(10_000, Math.round(percent * 100)));
}

function amountForBps(amount: number, basisPoints: number) {
  return Math.round((wholeNaira(amount) * Math.max(0, Math.round(basisPoints))) / BPS_DENOMINATOR);
}

function customerPriceForSellerPrice(sellerPrice: number) {
  const sellerAmount = wholeNaira(sellerPrice);
  return sellerAmount + amountForBps(sellerAmount, CUSTOMER_MARKUP_BPS);
}

function normalizeBogoSettings(input: Partial<BogoSettings> | null | undefined): BogoSettings {
  const rawMode = cleanString(input?.free_shipping_mode, 30).toUpperCase();
  const freeShippingMode = rawMode === "FULL_THRESHOLD" || rawMode === "PERCENTAGE_CAP" || rawMode === "HYBRID"
    ? rawMode
    : "HYBRID";
  return {
    bogo_promo_enabled: input?.bogo_promo_enabled === true,
    // The promo is funded from the 20% marketplace markup, never more.
    bogo_profit_share_percent: Math.min(20, Math.max(0, percentToBps(input?.bogo_profit_share_percent, 1_000) / 100)),
    bogo_min_order_value: wholeNaira(input?.bogo_min_order_value),
    free_shipping_promo_enabled: input?.free_shipping_promo_enabled === true,
    free_shipping_mode: freeShippingMode,
    free_shipping_profit_share_percent: Math.min(20, Math.max(0, percentToBps(input?.free_shipping_profit_share_percent, 1_000) / 100)),
    free_shipping_min_order_value: wholeNaira(input?.free_shipping_min_order_value, 100),
    allow_promo_stacking: input?.allow_promo_stacking === true,
  };
}

function calculateBogoPricing(input: BogoPricingInput) {
  const settings = normalizeBogoSettings(input.settings);
  const paidItems = (input.paid_items || []).map(item => ({
    ...item,
    seller_price: wholeNaira(item.seller_price),
    qty: Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1))),
  })).filter(item => item.id && item.seller_price > 0);

  if (!paidItems.length) throw new Error("A paid item is required for checkout.");

  const primary = paidItems.find(item => item.id === String(input.primary_item_id || ""))
    || [...paidItems].sort((left, right) => (right.seller_price * right.qty) - (left.seller_price * left.qty))[0]
    || null;
  const paidMerchandiseTotal = paidItems.reduce(
    (sum, item) => sum + customerPriceForSellerPrice(item.seller_price) * item.qty,
    0,
  );
  const primaryItemTotal = primary ? customerPriceForSellerPrice(primary.seller_price) * primary.qty : 0;

  // The 10% (profit share) from EVERY item ordered adds up together for the free gift allowance
  const profitShareBps = percentToBps(settings.bogo_profit_share_percent, 1_000);
  const totalGiftAllowance = paidItems.reduce((sum, item) => {
    const itemTotalSeller = item.seller_price * item.qty;
    return sum + amountForBps(itemTotalSeller, profitShareBps);
  }, 0);
  const minOrderMet = paidMerchandiseTotal >= settings.bogo_min_order_value;

  let qualificationReason = "";
  if (!settings.bogo_promo_enabled) qualificationReason = "The Free Gift promotion is not active.";
  else if (!minOrderMet) qualificationReason = `This order needs at least ₦${settings.bogo_min_order_value.toLocaleString()} in merchandise to qualify for a free gift.`;
  else if (totalGiftAllowance < 1) qualificationReason = "No gift allowance available for this order.";

  const qualified = !qualificationReason;
  const requestedGift = input.free_gift
    ? { ...input.free_gift, seller_price: wholeNaira(input.free_gift.seller_price), qty: 1 }
    : null;
  if (requestedGift && !qualified) throw new Error(qualificationReason);
  if (requestedGift && paidItems.some(item => item.id === requestedGift.id)) {
    throw new Error("Choose a gift that is not already a paid cart item.");
  }
  if (requestedGift && requestedGift.seller_price <= 0) throw new Error("The selected gift has no valid seller price.");

  const promoContribution = requestedGift ? Math.min(requestedGift.seller_price, totalGiftAllowance) : 0;
  const giftSellerBalance = requestedGift ? Math.max(0, requestedGift.seller_price - promoContribution) : 0;
  const extraCustomerCharge = requestedGift ? customerPriceForSellerPrice(giftSellerBalance) : 0;
  const mainPlatformMarkup = primary ? amountForBps(primary.seller_price * primary.qty, CUSTOMER_MARKUP_BPS) : 0;

  // Allocate promo contribution proportionally across all paid items based on their contribution to the gift allowance
  let allocatedPromoDiscount = 0;
  const allocations: BogoAllocation[] = paidItems.map((item, index) => {
    const sellerAmount = item.seller_price * item.qty;
    const customerAmount = customerPriceForSellerPrice(item.seller_price) * item.qty;
    const itemMarkup = customerAmount - sellerAmount;
    const itemMaxCap = amountForBps(sellerAmount, profitShareBps);

    let itemPromoDiscount = 0;
    if (requestedGift && promoContribution > 0 && totalGiftAllowance > 0) {
      if (index === paidItems.length - 1) {
        itemPromoDiscount = Math.min(itemMarkup, Math.max(0, promoContribution - allocatedPromoDiscount));
      } else {
        itemPromoDiscount = Math.min(itemMarkup, Math.round((promoContribution * itemMaxCap) / totalGiftAllowance));
        allocatedPromoDiscount += itemPromoDiscount;
      }
    }

    const isPrimary = Boolean(requestedGift && (item.id === primary?.id || itemPromoDiscount > 0));
    return {
      allocation_key: `paid:${item.id}`,
      allocation_type: isPrimary ? "bogo_primary" : "paid_item",
      seller_id: item.seller_id || null,
      product_id: item.id,
      seller_amount: sellerAmount,
      customer_amount: customerAmount,
      platform_revenue_amount: Math.max(0, itemMarkup - itemPromoDiscount),
      platform_promo_discount_amount: itemPromoDiscount,
    };
  });

  if (requestedGift) {
    allocations.push({
      allocation_key: `gift:${requestedGift.id}`,
      allocation_type: "bogo_gift",
      seller_id: requestedGift.seller_id || null,
      product_id: requestedGift.id,
      seller_amount: requestedGift.seller_price,
      customer_amount: extraCustomerCharge,
      platform_revenue_amount: Math.max(0, extraCustomerCharge - giftSellerBalance),
      platform_promo_discount_amount: promoContribution,
    });
  }

  const shippingGroups = (input.shipping_groups || []).map(group => ({
    seller_name: cleanString(group?.seller_name, 160) || "Seller",
    fee: wholeNaira(group?.fee),
  })).filter(group => group.fee > 0);
  const shippingTotal = shippingGroups.reduce((sum, group) => sum + group.fee, 0);
  const merchandiseTotal = paidMerchandiseTotal + extraCustomerCharge;
  // Shipping can run independently. When BOGO has no selected primary, the
  // highest seller-price paid item becomes the deterministic funding source.
  const shippingPrimary = primary || [...paidItems].sort((left, right) => right.seller_price - left.seller_price)[0] || null;
  const shippingThresholdMet = merchandiseTotal >= settings.free_shipping_min_order_value;
  const maxShippingDiscount = shippingPrimary
    ? amountForBps(shippingPrimary.seller_price, percentToBps(settings.free_shipping_profit_share_percent, 1_000))
    : 0;
  const stackingBlocked = Boolean(requestedGift && !settings.allow_promo_stacking);
  let shippingDiscount = 0;
  let shippingQualificationReason = "";
  if (!shippingTotal) shippingQualificationReason = "This checkout has no delivery shipping fee.";
  else if (!settings.free_shipping_promo_enabled) shippingQualificationReason = "The free-shipping promotion is not active.";
  else if (stackingBlocked) shippingQualificationReason = "Free shipping cannot be combined with a BOGO gift on this order.";
  else if (settings.free_shipping_mode === "FULL_THRESHOLD") {
    if (shippingThresholdMet) shippingDiscount = shippingTotal;
    else shippingQualificationReason = `This order needs at least â‚¦${settings.free_shipping_min_order_value.toLocaleString()} in merchandise for free shipping.`;
  } else if (settings.free_shipping_mode === "PERCENTAGE_CAP") {
    shippingDiscount = Math.min(shippingTotal, maxShippingDiscount);
  } else if (shippingThresholdMet) {
    shippingDiscount = shippingTotal;
  } else {
    shippingDiscount = Math.min(shippingTotal, maxShippingDiscount);
  }

  let subsidyRemaining = shippingDiscount;
  const logisticsAllocations: LogisticsAllocation[] = shippingGroups.map((group, index) => {
    const platformShippingSubsidy = Math.min(group.fee, subsidyRemaining);
    subsidyRemaining -= platformShippingSubsidy;
    return {
      allocation_key: `shipping:${index + 1}`,
      courier_amount: group.fee,
      customer_shipping_amount: group.fee - platformShippingSubsidy,
      platform_shipping_subsidy: platformShippingSubsidy,
    };
  });
  const customerShippingCharge = logisticsAllocations.reduce((sum, allocation) => sum + allocation.customer_shipping_amount, 0);
  const platformShippingSubsidy = logisticsAllocations.reduce((sum, allocation) => sum + allocation.platform_shipping_subsidy, 0);
  const totalAmount = merchandiseTotal + customerShippingCharge;
  const platformRevenue = allocations.reduce((sum, allocation) => sum + allocation.platform_revenue_amount, 0);

  return {
    settings,
    eligible: qualified,
    qualification_reason: qualificationReason || null,
    paid_merchandise_total: paidMerchandiseTotal,
    main_item_total: primaryItemTotal,
    max_free_seller_price: totalGiftAllowance,
    max_free_customer_price: customerPriceForSellerPrice(totalGiftAllowance),
    selected_free_item_seller_price: requestedGift?.seller_price || 0,
    platform_promo_contribution: promoContribution,
    platform_promo_discount_amount: promoContribution,
    extra_customer_charge: extraCustomerCharge,
    shipping_total: shippingTotal,
    customer_shipping_charge: customerShippingCharge,
    shipping_discount_amount: platformShippingSubsidy,
    platform_shipping_subsidy: platformShippingSubsidy,
    max_shipping_discount: maxShippingDiscount,
    shipping_threshold_met: shippingThresholdMet,
    shipping_qualification_reason: shippingQualificationReason || null,
    shipping_primary_item_id: shippingPrimary?.id || null,
    is_free_shipping_applied: platformShippingSubsidy > 0,
    merchandise_total: merchandiseTotal,
    total_amount: totalAmount,
    platform_revenue_amount: platformRevenue,
    platform_net_revenue_amount: platformRevenue - platformShippingSubsidy,
    primary_platform_revenue_after_promo: requestedGift ? Math.max(0, mainPlatformMarkup - promoContribution) : mainPlatformMarkup,
    is_bogo_order: Boolean(requestedGift),
    bogo_primary_item_id: requestedGift ? primary?.id || null : null,
    bogo_free_item_id: requestedGift?.id || null,
    allocations,
    logistics_allocations: logisticsAllocations,
  };
}

/**
 * The BOGO promotion deliberately lives behind this Edge Function.  Product
 * seller prices are held in the private `product_seller_pricing` table and
 * are never accepted from, or written back to, the browser.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUYSELL_DELIVERY_FEE = 2_500;
const MAX_CART_ITEMS = 100;
const MAX_GIFT_RESULTS = 100;

type InputCartItem = { id: string; qty: number };

type PricedProduct = SellerPricedItem & {
  name: string;
  image_url: string | null;
  category: string | null;
  public_price: number;
  stock_quantity: number;
};

type CheckoutQuote = {
  settings: BogoSettings;
  paid_items: PricedProduct[];
  free_gift: PricedProduct | null;
  primary_item_id: string | null;
  delivery_mode: "delivery" | "pickup";
  shipping_groups: Array<{ seller_name: string; fee: number }>;
  pricing: ReturnType<typeof calculateBogoPricing>;
};

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RequestError";
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function cleanString(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function isSafeProductId(value: string) {
  // BUYSELL products are UUIDs today; accepting numeric IDs too keeps the
  // endpoint compatible with an older integer-key catalogue without allowing
  // malformed PostgREST filters through.
  return /^(?:[0-9a-f]{8}-[0-9a-f-]{27,72}|[1-9][0-9]*)$/i.test(value);
}

function normaliseProductId(value: unknown) {
  const id = cleanString(value, 80);
  return isSafeProductId(id) ? id : "";
}

function normaliseCart(input: unknown): InputCartItem[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CART_ITEMS) {
    throw new RequestError("Your cart is empty or invalid.");
  }

  const grouped = new Map<string, number>();
  for (const rawItem of input) {
    const item = asRecord(rawItem);
    const id = normaliseProductId(item.id ?? item.product_id);
    const rawQty = item.qty ?? item.quantity ?? 1;
    const qty = Math.floor(Number(rawQty));
    if (!id || !Number.isFinite(qty) || qty < 1 || qty > 99) {
      throw new RequestError("Your cart contains an invalid product or quantity.");
    }
    const nextQuantity = (grouped.get(id) || 0) + qty;
    if (nextQuantity > 99) throw new RequestError("A product quantity cannot exceed 99.");
    grouped.set(id, nextQuantity);
  }

  if (!grouped.size || grouped.size > MAX_CART_ITEMS) throw new RequestError("Your cart is invalid.");
  return Array.from(grouped, ([id, qty]) => ({ id, qty }));
}

function deliveryModeFor(body: Record<string, unknown>): "delivery" | "pickup" {
  return cleanString(body.delivery_mode, 20).toLowerCase() === "pickup" ? "pickup" : "delivery";
}

function primaryIdFor(body: Record<string, unknown>) {
  return normaliseProductId(body.bogo_primary_item_id ?? body.main_item_id ?? body.mainItemId) || null;
}

function freeGiftIdFor(body: Record<string, unknown>) {
  return normaliseProductId(body.bogo_free_item_id ?? body.free_item_id ?? body.freeItemId) || null;
}

function publicImage(product: Record<string, unknown>) {
  const image = cleanString(product.image_url, 1_500);
  if (image) return image;
  const images = Array.isArray(product.images) ? product.images : [];
  const photo = cleanString(images[0], 1_500);
  if (photo) return photo;
  // Video-only products (common for WhatsApp imports): a still from the
  // Cloudinary video, so gifts and checkout lines show the actual product.
  const videos = Array.isArray(product.videos) ? product.videos : [];
  const video = cleanString(product.video_url, 1_500) || cleanString(videos[0], 1_500);
  if (!video.includes("res.cloudinary.com/") || !video.includes("/video/upload/")) return null;
  const still = video.replace("/video/upload/", "/video/upload/so_auto,c_fill,w_600,h_600,q_auto/").split("?")[0];
  return /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(still) ? still.replace(/\.[a-z0-9]+$/i, ".jpg") : `${still}.jpg`;
}

function publicProduct(product: PricedProduct) {
  // `public_price` is already exposed through the existing marketplace.  Do
  // not return `seller_price` here: the private price table remains private.
  return {
    id: product.id,
    name: product.name,
    image_url: product.image_url,
    category: product.category,
    price: product.public_price,
  };
}

function configuredAdminEmails() {
  const raw = Deno.env.get("BOGO_ADMIN_EMAILS") || Deno.env.get("WHATSAPP_ADMIN_EMAILS") || "";
  return raw.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

function parseBoolean(value: unknown) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

async function requireUser(admin: ReturnType<typeof createClient>, req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new RequestError("Please sign in to continue.", 401);

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new RequestError("Your session is invalid. Please sign in again.", 401);
  return data.user;
}

async function requireDashboardAdmin(admin: ReturnType<typeof createClient>, user: { id: string; email?: string | null }) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,accounts")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error("Could not verify the administrator account.");

  const role = cleanString(profile?.role, 40).toLowerCase();
  const accountType = cleanString(profile?.accounts, 40).toLowerCase();
  const email = cleanString(user.email, 320).toLowerCase();
  const trustedRole = role === "admin" || role === "super_admin" || accountType === "admin";
  if (!trustedRole && !configuredAdminEmails().includes(email)) {
    throw new RequestError("Administrator access is required.", 403);
  }
}

async function loadSettings(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from("bogo_promo_settings")
    .select("bogo_promo_enabled,bogo_profit_share_percent,bogo_min_order_value,free_shipping_promo_enabled,free_shipping_mode,free_shipping_profit_share_percent,free_shipping_min_order_value,allow_promo_stacking")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error("Could not load the BOGO promotion settings.");
  return normalizeBogoSettings(data || undefined);
}

async function loadPricedProducts(admin: ReturnType<typeof createClient>, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return new Map<string, PricedProduct>();

  const { data: products, error: productError } = await admin
    .from("products")
    .select("id,seller_id,name,image_url,images,video_url,videos,price,status,stock_quantity,category")
    .in("id", uniqueIds);
  if (productError) throw new Error("Could not verify the products in your cart.");

  const productById = new Map((products || []).map((product: any) => [String(product.id), product]));
  if (productById.size !== uniqueIds.length) throw new RequestError("One or more products are no longer available.", 409);

  const { data: priceRows, error: priceError } = await admin
    .from("product_seller_pricing")
    .select("product_id,seller_price")
    .in("product_id", uniqueIds);
  if (priceError) throw new Error("Could not securely price the products in your cart.");
  const priceByProduct = new Map((priceRows || []).map((row: any) => [String(row.product_id), wholeNaira(row.seller_price)]));

  const result = new Map<string, PricedProduct>();
  for (const id of uniqueIds) {
    const product: any = productById.get(id);
    let sellerPrice = priceByProduct.get(id) || 0;
    const stock = Math.floor(Number(product?.stock_quantity));
    if (String(product?.status || "").toLowerCase() !== "active") {
      throw new RequestError("An item in your cart is no longer active.", 409);
    }
    if (!Number.isFinite(stock) || stock < 1) {
      throw new RequestError("An item in your cart is out of stock.", 409);
    }
    if (sellerPrice < 1) {
      const publicPrice = wholeNaira(product?.price);
      if (publicPrice > 0) {
        // Derive seller price by reversing the 20% platform markup
        sellerPrice = Math.max(1, Math.round(publicPrice / 1.20));
        // Persist into product_seller_pricing so future operations have it cached
        try {
          await admin.from("product_seller_pricing").upsert({
            product_id: id,
            seller_price: sellerPrice,
            source: "derived_from_public_price",
          }, { onConflict: "product_id" });
        } catch (_err) {
          // Non-blocking caching attempt
        }
      } else {
        throw new RequestError("This product is not ready for secure checkout.", 409);
      }
    }
    result.set(id, {
      id,
      seller_id: product.seller_id ? String(product.seller_id) : null,
      seller_price: sellerPrice,
      qty: 1,
      name: cleanString(product.name, 300) || "Marketplace product",
      image_url: publicImage(product),
      category: cleanString(product.category, 80) || null,
      public_price: wholeNaira(product.price),
      stock_quantity: stock,
    });
  }
  return result;
}

// BUYSELL charges one flat delivery fee per order, however many stores supply it.
function shippingGroupsFor(items: PricedProduct[], deliveryMode: "delivery" | "pickup") {
  if (deliveryMode === "pickup" || !items.length) return [];
  return [{ seller_name: "BUYSELL delivery", fee: BUYSELL_DELIVERY_FEE }];
}

async function buildCheckoutQuote(admin: ReturnType<typeof createClient>, body: Record<string, unknown>): Promise<CheckoutQuote> {
  const cart = normaliseCart(body.cart);
  const settings = await loadSettings(admin);
  const requestedPrimaryId = primaryIdFor(body);
  const freeGiftId = freeGiftIdFor(body);
  const ids = [...cart.map((item) => item.id), ...(freeGiftId ? [freeGiftId] : [])];
  const productsById = await loadPricedProducts(admin, ids);

  const paidItems = cart.map((cartItem) => {
    const product = productsById.get(cartItem.id);
    if (!product) throw new RequestError("One or more products are no longer available.", 409);
    if (cartItem.qty > product.stock_quantity) {
      throw new RequestError("The requested quantity is no longer in stock.", 409);
    }
    return { ...product, qty: cartItem.qty };
  });

  const primaryItemId = (requestedPrimaryId && paidItems.some((item) => item.id === requestedPrimaryId))
    ? requestedPrimaryId
    : (paidItems[0]?.id || null);

  const gift = freeGiftId ? productsById.get(freeGiftId) || null : null;
  if (freeGiftId && !gift) throw new RequestError("The selected free gift is no longer available.", 409);

  const deliveryMode = deliveryModeFor(body);
  // Free gifts never add delivery: the fee is based on the paid items only.
  const shippingGroups = shippingGroupsFor(paidItems, deliveryMode);
  const pricing = calculateBogoPricing({
    paid_items: paidItems,
    primary_item_id: primaryItemId,
    free_gift: gift ? {
      id: gift.id,
      seller_id: gift.seller_id,
      seller_price: gift.seller_price,
      name: gift.name,
      image_url: gift.image_url,
    } : null,
    settings,
    shipping_groups: shippingGroups,
  });

  return {
    settings,
    paid_items: paidItems,
    free_gift: gift,
    primary_item_id: primaryItemId,
    delivery_mode: deliveryMode,
    shipping_groups: shippingGroups,
    pricing,
  };
}

function quoteItems(quote: CheckoutQuote) {
  const items = quote.paid_items.map((item) => {
    const unitPrice = customerPriceForSellerPrice(item.seller_price);
    return {
      ...publicProduct(item),
      product_id: item.id,
      qty: item.qty,
      quantity: item.qty,
      price: unitPrice,
      unit_price: unitPrice,
      total: unitPrice * item.qty,
      is_bogo_gift: false,
    };
  });
  if (quote.free_gift) {
    items.push({
      ...publicProduct(quote.free_gift),
      product_id: quote.free_gift.id,
      qty: 1,
      quantity: 1,
      // A gift above the promotion cap is still valid, but only the secure
      // server-calculated top-up is payable by the buyer.
      price: quote.pricing.extra_customer_charge,
      unit_price: quote.pricing.extra_customer_charge,
      total: quote.pricing.extra_customer_charge,
      is_bogo_gift: true,
    });
  }
  return items;
}

function publicQuote(quote: CheckoutQuote) {
  const pricing = quote.pricing;
  return {
    settings: quote.settings,
    items: quoteItems(quote),
    delivery_mode: quote.delivery_mode,
    shipping_groups: quote.shipping_groups,
    shipping_total: pricing.shipping_total,
    customer_shipping_charge: pricing.customer_shipping_charge,
    shipping_discount_amount: pricing.shipping_discount_amount,
    platform_shipping_subsidy: pricing.platform_shipping_subsidy,
    is_free_shipping_applied: pricing.is_free_shipping_applied,
    merchandise_total: pricing.merchandise_total,
    total_amount: pricing.total_amount,
    bogo: {
      enabled: quote.settings.bogo_promo_enabled,
      min_order_value: quote.settings.bogo_min_order_value,
      eligible: pricing.eligible,
      qualification_reason: pricing.qualification_reason,
      primary_item_id: pricing.bogo_primary_item_id || quote.primary_item_id,
      free_item_id: pricing.bogo_free_item_id,
      max_free_seller_price: pricing.max_free_seller_price,
      max_free_customer_price: pricing.max_free_customer_price,
      is_bogo_order: pricing.is_bogo_order,
      platform_promo_discount_amount: pricing.platform_promo_discount_amount,
      extra_customer_charge: pricing.extra_customer_charge,
    },
    free_shipping: {
      enabled: quote.settings.free_shipping_promo_enabled,
      mode: quote.settings.free_shipping_mode,
      min_order_value: quote.settings.free_shipping_min_order_value,
      profit_share_percent: quote.settings.free_shipping_profit_share_percent,
      allow_promo_stacking: quote.settings.allow_promo_stacking,
      is_applied: pricing.is_free_shipping_applied,
      shipping_total: pricing.shipping_total,
      customer_shipping_charge: pricing.customer_shipping_charge,
      shipping_discount_amount: pricing.shipping_discount_amount,
      qualification_reason: pricing.shipping_qualification_reason,
    },
  };
}

function quoteFingerprint(quote: CheckoutQuote) {
  // A stable, non-secret idempotency check for a Flutterwave tx_ref. It keeps
  // a retried request tied to the exact cart and gift selection that produced
  // the pending order, without placing seller prices in the order snapshot.
  const paid = quote.paid_items
    .map((item) => ({ id: item.id, qty: item.qty }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify({
    paid,
    primary_item_id: quote.primary_item_id,
    free_item_id: quote.pricing.bogo_free_item_id,
    delivery_mode: quote.delivery_mode,
    free_shipping_mode: quote.settings.free_shipping_mode,
    free_shipping_enabled: quote.settings.free_shipping_promo_enabled,
    allow_promo_stacking: quote.settings.allow_promo_stacking,
  });
}

async function eligibleGifts(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  // Ignore a stale selection while calculating eligibility.  A selected gift
  // that is no longer valid must not alter the main item's cap.
  const quoteInput = { ...body };
  delete quoteInput.bogo_free_item_id;
  delete quoteInput.free_item_id;
  delete quoteInput.freeItemId;
  const quote = await buildCheckoutQuote(admin, quoteInput);
  const pricing = quote.pricing;
  const base = publicQuote(quote);

  if (!quote.settings.bogo_promo_enabled || !pricing.eligible || pricing.max_free_seller_price < 1) {
    return json({
      success: true,
      eligible: false,
      qualification_reason: pricing.qualification_reason || "This order does not qualify for a free gift.",
      gifts: [],
      quote: base,
      max_allowance: 0,
    });
  }

  const paidIds = new Set(quote.paid_items.map((item) => item.id));
  const searchTerm = cleanString(body.search || body.q, 100);
  const categoryFilter = cleanString(body.category, 60);
  const sortMode = cleanString(body.sort, 40).toLowerCase();

  // Query active products strictly capped by the accumulated 10% allowance
  let query = admin
    .from("products")
    .select("id,seller_id,name,image_url,images,video_url,videos,price,category,status,stock_quantity,created_at")
    .eq("status", "active")
    .gt("stock_quantity", 0)
    .gt("price", 0)
    .lte("price", pricing.max_free_customer_price);

  if (searchTerm) {
    query = query.ilike("name", `%${searchTerm}%`);
  }
  if (categoryFilter && categoryFilter.toLowerCase() !== "all") {
    query = query.ilike("category", `%${categoryFilter}%`);
  }

  // Ordering: default to closest to allowance (highest price first)
  if (sortMode === "asc" || sortMode === "price_asc") {
    query = query.order("price", { ascending: true });
  } else if (sortMode === "newest") {
    query = query.order("created_at", { ascending: false });
  } else {
    // Default: 'closest' / highest value first so gifts close to the allowance appear first
    query = query.order("price", { ascending: false });
  }

  query = query.limit(MAX_GIFT_RESULTS * 2);

  const { data: rawProducts, error: productError } = await query;
  if (productError) throw new Error("Could not load eligible gifts.");

  const candidateProducts = (rawProducts || [])
    .filter((p: any) => isSafeProductId(String(p.id)) && !paidIds.has(String(p.id)));

  if (!candidateProducts.length) {
    return json({
      success: true,
      eligible: true,
      qualification_reason: null,
      gifts: [],
      quote: base,
      max_allowance: pricing.max_free_customer_price,
    });
  }

  const candidateIds = candidateProducts.map((p: any) => String(p.id));
  const { data: priceRows } = await admin
    .from("product_seller_pricing")
    .select("product_id,seller_price")
    .in("product_id", candidateIds);

  const priceByProduct = new Map((priceRows || []).map((row: any) => [String(row.product_id), wholeNaira(row.seller_price)]));

  const validGifts: any[] = [];
  const unpricedToUpsert: { product_id: string; seller_price: number; source: string }[] = [];

  for (const product of candidateProducts) {
    const id = String(product.id);
    const publicPrice = wholeNaira(product.price);
    let sellerPrice = priceByProduct.get(id) || 0;

    if (sellerPrice < 1) {
      sellerPrice = Math.max(1, Math.round(publicPrice / 1.20));
      unpricedToUpsert.push({
        product_id: id,
        seller_price: sellerPrice,
        source: "derived_from_public_price",
      });
    }

    // In all cases, the gift must not exceed the accumulated 10% allowance
    if (sellerPrice > pricing.max_free_seller_price || publicPrice > pricing.max_free_customer_price) {
      continue;
    }

    validGifts.push({
      id,
      name: cleanString(product.name, 300) || "Marketplace product",
      image_url: publicImage(product),
      category: cleanString(product.category, 80) || null,
      price: publicPrice,
      seller_price: sellerPrice,
      is_eligible_free_gift: true,
    });

    if (validGifts.length >= MAX_GIFT_RESULTS) break;
  }

  // Asynchronously persist any derived seller prices so checkout never blocks
  if (unpricedToUpsert.length > 0) {
    try {
      await admin.from("product_seller_pricing").upsert(unpricedToUpsert, { onConflict: "product_id" });
    } catch (_) {}
  }

  return json({
    success: true,
    eligible: true,
    qualification_reason: null,
    gifts: validGifts,
    quote: base,
    max_allowance: pricing.max_free_customer_price,
  });
}

function validateProofUrl(value: unknown) {
  const raw = cleanString(value, 2_000);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("not https");
    return url.toString();
  } catch {
    throw new RequestError("Upload a valid HTTPS payment receipt before submitting your order.");
  }
}

function orderDeliveryDetails(body: Record<string, unknown>, deliveryMode: "delivery" | "pickup") {
  const name = cleanString(body.delivery_name, 160);
  const phone = cleanString(body.delivery_phone, 60);
  const address = cleanString(body.delivery_address, 1_000);
  if (deliveryMode === "delivery" && (name.length < 2 || phone.length < 5 || address.length < 5)) {
    throw new RequestError("Enter your name, phone number, and delivery address.");
  }
  return { name, phone, address };
}

type PendingOrderOptions = {
  payment_method: "buysell_bank_transfer";
  payment_ref: string;
  proof_url?: string;
  tracking_note: string;
};

async function insertPendingOrderWithAllocations(
  admin: ReturnType<typeof createClient>,
  user: { id: string },
  delivery: { name: string; phone: string; address: string },
  quote: CheckoutQuote,
  options: PendingOrderOptions,
) {
  const orderId = crypto.randomUUID();
  const orderItems = quoteItems(quote);
  const pricing = quote.pricing;

  const orderPayload: Record<string, unknown> = {
    id: orderId,
    buyer_id: user.id,
    // `seller_id` is retained for compatibility with legacy dashboards.  The
    // allocation ledger below is authoritative for multi-seller BOGO orders.
    seller_id: quote.paid_items[0]?.seller_id || null,
    items: orderItems,
    total_amount: pricing.total_amount,
    status: "pending",
    payment_method: options.payment_method,
    payment_ref: options.payment_ref,
    delivery_name: delivery.name,
    delivery_phone: delivery.phone,
    delivery_address: delivery.address,
    shipping_total: pricing.shipping_total,
    shipping_groups: quote.shipping_groups,
    shipping_discount_amount: pricing.shipping_discount_amount,
    is_free_shipping_applied: pricing.is_free_shipping_applied,
    platform_shipping_subsidy: pricing.platform_shipping_subsidy,
    is_bogo_order: pricing.is_bogo_order,
    bogo_primary_item_id: pricing.bogo_primary_item_id,
    bogo_free_item_id: pricing.bogo_free_item_id,
    platform_promo_discount_amount: pricing.platform_promo_discount_amount,
    bogo_extra_customer_charge: pricing.extra_customer_charge,
    // Keep a customer-safe audit trail of the applied settings. Seller prices
    // and per-seller payouts stay only in `order_seller_allocations`.
    bogo_pricing_snapshot: {
      formula_version: "commission-funded-promotions-v2",
      customer_markup_percent: 20,
      bogo_profit_share_percent: quote.settings.bogo_profit_share_percent,
      bogo_min_order_value: quote.settings.bogo_min_order_value,
      is_bogo_order: pricing.is_bogo_order,
      platform_promo_discount_amount: pricing.platform_promo_discount_amount,
      extra_customer_charge: pricing.extra_customer_charge,
      shipping_total: pricing.shipping_total,
      customer_shipping_charge: pricing.customer_shipping_charge,
      shipping_discount_amount: pricing.shipping_discount_amount,
      platform_shipping_subsidy: pricing.platform_shipping_subsidy,
      is_free_shipping_applied: pricing.is_free_shipping_applied,
      total_amount: pricing.total_amount,
      checkout_fingerprint: quoteFingerprint(quote),
    },
    free_shipping_pricing_snapshot: {
      mode: quote.settings.free_shipping_mode,
      free_shipping_promo_enabled: quote.settings.free_shipping_promo_enabled,
      free_shipping_profit_share_percent: quote.settings.free_shipping_profit_share_percent,
      free_shipping_min_order_value: quote.settings.free_shipping_min_order_value,
      allow_promo_stacking: quote.settings.allow_promo_stacking,
      shipping_primary_item_id: pricing.shipping_primary_item_id,
      shipping_threshold_met: pricing.shipping_threshold_met,
      shipping_total: pricing.shipping_total,
      customer_shipping_charge: pricing.customer_shipping_charge,
      platform_shipping_subsidy: pricing.platform_shipping_subsidy,
      qualification_reason: pricing.shipping_qualification_reason,
    },
    created_at: new Date().toISOString(),
  };
  if (options.proof_url) orderPayload.proof_url = options.proof_url;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert(orderPayload)
    .select("id,total_amount")
    .single();
  if (orderError || !order) throw new Error(orderError?.message || "Could not create the order.");

  const allocations = pricing.allocations.map((allocation) => ({
    order_id: order.id,
    allocation_key: allocation.allocation_key,
    allocation_type: allocation.allocation_type,
    seller_id: allocation.seller_id,
    product_id: allocation.product_id,
    seller_amount: allocation.seller_amount,
    customer_amount: allocation.customer_amount,
    platform_revenue_amount: allocation.platform_revenue_amount,
    platform_promo_discount_amount: allocation.platform_promo_discount_amount,
    payout_status: "pending",
  }));
  const { error: allocationError } = await admin.from("order_seller_allocations").insert(allocations);
  if (allocationError) {
    // There is no cross-table transaction through the Data API.  Compensate
    // immediately so an order never exists without its seller obligations.
    await admin.from("orders").delete().eq("id", order.id).eq("buyer_id", user.id);
    throw new Error("Could not record seller payouts for this order.");
  }

  const logisticsAllocations = pricing.logistics_allocations.map((allocation) => ({
    order_id: order.id,
    allocation_key: allocation.allocation_key,
    courier_amount: allocation.courier_amount,
    customer_shipping_amount: allocation.customer_shipping_amount,
    platform_shipping_subsidy: allocation.platform_shipping_subsidy,
    payout_status: "pending",
  }));
  if (logisticsAllocations.length) {
    const { error: logisticsError } = await admin.from("order_logistics_allocations").insert(logisticsAllocations);
    if (logisticsError) {
      // Keep the multi-table write compensating: a pending order is valid only
      // with both seller and courier obligations recorded.
      await admin.from("orders").delete().eq("id", order.id).eq("buyer_id", user.id);
      throw new Error("Could not record logistics funding for this order.");
    }
  }

  try {
    await admin.from("order_tracking").insert({
      order_id: order.id,
      status: "pending",
      note: options.tracking_note,
      created_at: new Date().toISOString(),
    });
  } catch (_) {
    // Older installations may not have the optional tracking table.
  }

  return { id: String(order.id), total_amount: Number(order.total_amount) };
}

async function createTransferOrder(
  admin: ReturnType<typeof createClient>,
  user: { id: string },
  body: Record<string, unknown>,
) {
  const proofUrl = validateProofUrl(body.proof_url);
  const quote = await buildCheckoutQuote(admin, body);
  const delivery = orderDeliveryDetails(body, quote.delivery_mode);
  const paymentRef = cleanString(body.payment_ref ?? body.transfer_ref, 160);
  const order = await insertPendingOrderWithAllocations(admin, user, delivery, quote, {
    payment_method: "buysell_bank_transfer",
    payment_ref: paymentRef,
    proof_url: proofUrl,
    tracking_note: "Bank transfer receipt submitted for BUYSELL review.",
  });
  return json({ success: true, order_id: order.id, total_amount: order.total_amount, quote: publicQuote(quote) }, 201);
}

async function adminGetConfig(admin: ReturnType<typeof createClient>) {
  const settings = await loadSettings(admin);
  return json({ success: true, config: settings });
}

async function adminUpdateConfig(admin: ReturnType<typeof createClient>, user: { id: string }, body: Record<string, unknown>) {
  const current = await loadSettings(admin);
  const input = asRecord(body.config);
  const source = Object.keys(input).length ? input : body;
  const next: BogoSettings = { ...current };

  if (hasOwn(source, "bogo_promo_enabled")) {
    const enabled = parseBoolean(source.bogo_promo_enabled);
    if (enabled === null) throw new RequestError("Choose whether the BOGO promotion is enabled.");
    next.bogo_promo_enabled = enabled;
  }
  if (hasOwn(source, "bogo_profit_share_percent")) {
    const percent = finiteNumber(source.bogo_profit_share_percent);
    if (percent === null || percent < 0 || percent > 20) {
      throw new RequestError("The promotion share must be between 0% and 20%.");
    }
    next.bogo_profit_share_percent = percent;
  }
  if (hasOwn(source, "bogo_min_order_value")) {
    const minimum = finiteNumber(source.bogo_min_order_value);
    if (minimum === null || minimum < 0 || minimum > 100_000_000) {
      throw new RequestError("Enter a valid minimum order value.");
    }
    next.bogo_min_order_value = Math.round(minimum);
  }
  if (hasOwn(source, "free_shipping_promo_enabled")) {
    const enabled = parseBoolean(source.free_shipping_promo_enabled);
    if (enabled === null) throw new RequestError("Choose whether free shipping is enabled.");
    next.free_shipping_promo_enabled = enabled;
  }
  if (hasOwn(source, "free_shipping_mode")) {
    const mode = cleanString(source.free_shipping_mode, 30).toUpperCase();
    if (!["FULL_THRESHOLD", "PERCENTAGE_CAP", "HYBRID"].includes(mode)) {
      throw new RequestError("Choose a valid free-shipping mode.");
    }
    next.free_shipping_mode = mode as BogoSettings["free_shipping_mode"];
  }
  if (hasOwn(source, "free_shipping_profit_share_percent")) {
    const percent = finiteNumber(source.free_shipping_profit_share_percent);
    if (percent === null || percent < 0 || percent > 20) {
      throw new RequestError("The free-shipping share must be between 0% and 20%.");
    }
    next.free_shipping_profit_share_percent = percent;
  }
  if (hasOwn(source, "free_shipping_min_order_value")) {
    const minimum = finiteNumber(source.free_shipping_min_order_value);
    if (minimum === null || minimum < 0 || minimum > 100_000_000) {
      throw new RequestError("Enter a valid free-shipping minimum order value.");
    }
    next.free_shipping_min_order_value = Math.round(minimum);
  }
  if (hasOwn(source, "allow_promo_stacking")) {
    const enabled = parseBoolean(source.allow_promo_stacking);
    if (enabled === null) throw new RequestError("Choose whether promotions may be combined.");
    next.allow_promo_stacking = enabled;
  }

  const config = normalizeBogoSettings(next);
  const { data, error } = await admin
    .from("bogo_promo_settings")
    .upsert({ id: true, ...config, updated_by: user.id }, { onConflict: "id" })
    .select("bogo_promo_enabled,bogo_profit_share_percent,bogo_min_order_value,free_shipping_promo_enabled,free_shipping_mode,free_shipping_profit_share_percent,free_shipping_min_order_value,allow_promo_stacking")
    .single();
  if (error) throw new Error("Could not save the BOGO promotion settings.");
  return json({ success: true, config: normalizeBogoSettings(data) });
}

async function sellerPayoutSummary(admin: ReturnType<typeof createClient>, user: { id: string }) {
  // The allocation ledger is deliberately private.  A seller only receives a
  // compact aggregate for their own completed deliveries, never another
  // seller's allocation or the platform's private pricing information.
  const { data: allocations, error: allocationError } = await admin
    .from("order_seller_allocations")
    .select("order_id,allocation_type,seller_amount,payout_status,created_at")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (allocationError) throw new Error("Could not load your seller payout summary.");

  const allocationOrderIds = Array.from(new Set((allocations || []).map((row: any) => String(row.order_id || "")).filter(Boolean)));
  let deliveredAllocationOrderIds = new Set<string>();
  if (allocationOrderIds.length) {
    const { data: deliveredOrders, error: orderError } = await admin
      .from("orders")
      .select("id")
      .in("id", allocationOrderIds)
      .eq("status", "delivered");
    if (orderError) throw new Error("Could not verify delivered seller orders.");
    deliveredAllocationOrderIds = new Set((deliveredOrders || []).map((order: any) => String(order.id)));
  }
  const completedAllocations = (allocations || []).filter((row: any) => deliveredAllocationOrderIds.has(String(row.order_id)));
  const ledgerDeliveredSellerAmount = completedAllocations.reduce((sum: number, row: any) => sum + wholeNaira(row.seller_amount), 0);
  const paidOutAmount = completedAllocations
    .filter((row: any) => String(row.payout_status || "").toLowerCase() === "paid")
    .reduce((sum: number, row: any) => sum + wholeNaira(row.seller_amount), 0);
  const pendingPayoutAmount = completedAllocations
    .filter((row: any) => String(row.payout_status || "pending").toLowerCase() !== "paid")
    .reduce((sum: number, row: any) => sum + wholeNaira(row.seller_amount), 0);

  // Orders created before the allocation ledger only have the legacy
  // seller_id/total_amount relationship. Add those completed orders once,
  // but never add an order for which any allocation already exists.
  const { data: sellerDeliveredOrders, error: legacyOrderError } = await admin
    .from("orders")
    .select("id,total_amount")
    .eq("seller_id", user.id)
    .eq("status", "delivered")
    .order("created_at", { ascending: false })
    .limit(500);
  if (legacyOrderError) throw new Error("Could not load legacy delivered seller orders.");

  const legacyCandidateIds = (sellerDeliveredOrders || []).map((order: any) => String(order.id || "")).filter(Boolean);
  let ledgerBackedOrderIds = new Set<string>();
  if (legacyCandidateIds.length) {
    const { data: ledgerRows, error: ledgerLookupError } = await admin
      .from("order_seller_allocations")
      .select("order_id")
      .in("order_id", legacyCandidateIds);
    if (ledgerLookupError) throw new Error("Could not reconcile legacy seller revenue.");
    ledgerBackedOrderIds = new Set((ledgerRows || []).map((row: any) => String(row.order_id || "")).filter(Boolean));
  }
  const legacyDeliveredRevenue = (sellerDeliveredOrders || [])
    .filter((order: any) => !ledgerBackedOrderIds.has(String(order.id)))
    .reduce((sum: number, order: any) => sum + wholeNaira(order.total_amount), 0);
  const totalDeliveredRevenue = ledgerDeliveredSellerAmount + legacyDeliveredRevenue;

  return json({
    success: true,
    summary: {
      delivered_seller_amount: totalDeliveredRevenue,
      total_delivered_revenue: totalDeliveredRevenue,
      ledger_delivered_seller_amount: ledgerDeliveredSellerAmount,
      legacy_delivered_revenue: legacyDeliveredRevenue,
      pending_payout_amount: pendingPayoutAmount,
      paid_out_amount: paidOutAmount,
      allocation_count: completedAllocations.length,
    },
    allocations: completedAllocations.slice(0, 100).map((row: any) => ({
      order_id: String(row.order_id),
      allocation_type: cleanString(row.allocation_type, 40),
      seller_amount: wholeNaira(row.seller_amount),
      payout_status: cleanString(row.payout_status, 40) || "pending",
      created_at: row.created_at || null,
    })),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase service configuration is missing.");

    const body = asRecord(await req.json().catch(() => ({})));
    const action = cleanString(body.action, 60).toLowerCase();
    const admin = createClient(supabaseUrl, serviceKey);

    if (action === "public_active_promos" || action === "active_promos" || action === "get_active_promos") {
      const settings = await loadSettings(admin);
      return json({
        success: true,
        settings: {
          bogo_promo_enabled: settings.bogo_promo_enabled,
          bogo_profit_share_percent: settings.bogo_profit_share_percent,
          bogo_min_order_value: settings.bogo_min_order_value,
          free_shipping_promo_enabled: settings.free_shipping_promo_enabled,
          free_shipping_mode: settings.free_shipping_mode,
          free_shipping_min_order_value: settings.free_shipping_min_order_value,
          free_shipping_profit_share_percent: settings.free_shipping_profit_share_percent,
          allow_promo_stacking: settings.allow_promo_stacking,
        },
      });
    }

    const user = await requireUser(admin, req);

    if (action === "quote") {
      const quote = await buildCheckoutQuote(admin, body);
      return json({ success: true, quote: publicQuote(quote) });
    }
    if (action === "eligible_gifts" || action === "get_eligible_free_gifts" || action === "geteligiblefreegifts") {
      return await eligibleGifts(admin, body);
    }
    if (action === "create_transfer_order") return await createTransferOrder(admin, user, body);
    if (action === "create_flutterwave_pending") {
      throw new RequestError("Online payment is unavailable. Please pay by bank transfer and submit your receipt for verification.");
    }
    if (action === "seller_payout_summary") return await sellerPayoutSummary(admin, user);

    if (action === "admin_get_config") {
      await requireDashboardAdmin(admin, user);
      return await adminGetConfig(admin);
    }
    if (action === "admin_update_config") {
      await requireDashboardAdmin(admin, user);
      return await adminUpdateConfig(admin, user, body);
    }

    return json({ success: false, error: "Unknown BOGO promotion action." }, 400);
  } catch (error) {
    console.error("bogo-promo error:", error);
    const status = error instanceof RequestError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not process the BOGO promotion request.";
    return json({ success: false, error: message }, status);
  }
});
