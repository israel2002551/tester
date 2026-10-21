import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import * as cheerio from "npm:cheerio@1.0.0-rc.12"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const supplierNames: Record<string, string> = {
  aliexpress: "AliExpress",
  cj: "CJ Dropshipping",
  global: "Global Supplier",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

async function readJson(req: Request) {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

async function getAuthedClient(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) throw new Error("Missing authorization header")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function environment is not configured")

  const token = authHeader.replace("Bearer ", "")
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw new Error("Unauthorized")

  return { admin, user }
}

function handleOptions(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  return null
}

function fail(error: unknown) {
  let message = "Request failed"
  let stack = ""
  
  if (error instanceof Error) {
    message = error.message
    stack = error.stack || ""
  } else if (error && typeof error === "object") {
    message = "message" in error ? String((error as any).message) : JSON.stringify(error)
  } else if (typeof error === "string") {
    message = error
  }
  
  console.error(`[MANAGE DROPSHIP ERROR]: ${message}`)
  if (stack) console.error(`[STACK TRACE]: ${stack}`)
  
  return json({ error: message }, 400)
}

function missingColumn(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
  const quoted = text.match(/'([^']+)' column/i) || text.match(/column "([^"]+)"/i)
  return quoted?.[1] || ""
}

function supplierKey(value: unknown) {
  const key = String(value || "").trim().toLowerCase()
  if (!supplierNames[key]) throw new Error("Unknown supplier")
  return key
}

function positiveNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function ensureSellerProfile(admin: any, userId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("role,trial_end,is_suspended")
    .eq("id", userId)
    .single()
  if (error) throw error
  if (data?.role !== "seller" && data?.role !== "admin") {
    throw new Error("Forbidden: Seller access required")
  }
  if (data?.role === "admin") return
  const activeUntil = data?.trial_end ? new Date(data.trial_end) : null
  if (data?.is_suspended || !activeUntil || activeUntil <= new Date()) {
    throw new Error("Seller subscription expired. Please pay your commission to continue using seller tools.")
  }
}

async function insertProduct(admin: any, payload: Record<string, unknown>) {
  const insertPayload = { ...payload }

  for (let attempt = 0; attempt < 20; attempt++) {
    const { error, data } = await admin.from("products").insert(insertPayload).select("id").single()
    if (!error) return data

    const column = missingColumn(error)
    if (!column || !(column in insertPayload) || column === "is_dropship") throw error
    delete insertPayload[column]
  }

  throw new Error("Could not create dropship product with the available products table columns")
}

async function insertImport(admin: any, payload: Record<string, unknown>) {
  const insertPayload = { ...payload }

  for (let attempt = 0; attempt < 16; attempt++) {
    const { error } = await admin.from("dropship_imports").insert(insertPayload)
    if (!error) return

    const column = missingColumn(error)
    if (!column || !(column in insertPayload)) throw error
    delete insertPayload[column]
  }

  throw new Error("Could not record dropship import with the available columns")
}

function catalogToProductPayload(item: any, sellerId: string, overrides: any = {}) {
  const price = positiveNumber(overrides.price, positiveNumber(item.suggested_price))
  const supplierCost = positiveNumber(item.supplier_cost)
  const shippingCost = positiveNumber(item.shipping_cost)
  const delivery = item.delivery_estimate || "International shipping"

  return {
    name: String(overrides.name || item.name || "Dropship Product").trim(),
    description: `${overrides.description || item.description || `Imported from ${item.supplier_name}.`} Supplier cost estimate: ₦${Math.round(supplierCost).toLocaleString("en-NG")}. Delivery estimate: ${delivery}.`,
    price,
    original_price: price,
    category: "dropship",
    condition: "new",
    location: overrides.location || "International",
    image_url: overrides.image_url || item.image_url || "",
    has_video: false,
    negotiable: false,
    stock_quantity: Number.parseInt(String(overrides.stock_quantity ?? item.stock_quantity ?? 999), 10) || 999,
    low_stock_alert: 10,
    seller_id: sellerId,
    status: "active",
    is_dropship: true,
    dropship_supplier_key: item.supplier_key || "global",
    dropship_supplier_name: item.supplier_name || "Global Supplier",
    dropship_catalog_id: item.id || null,
    dropship_supplier_cost: supplierCost,
    dropship_shipping_cost: shippingCost,
    dropship_delivery_estimate: delivery,
  }
}

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const { admin, user } = await getAuthedClient(req)
    await ensureSellerProfile(admin, user.id)
    const body = await readJson(req)
    const action = body.action

    if (action === "list_connections") {
      const { data, error } = await admin
        .from("dropship_supplier_connections")
        .select("supplier_key,supplier_name,status,connected_at,updated_at")
        .eq("seller_id", user.id)
        .eq("status", "connected")
        .order("supplier_name", { ascending: true })
      if (error) throw error
      return json({ success: true, connections: data || [] })
    }

    if (action === "connect_supplier") {
      const key = supplierKey(body.supplier_key || body.supplier)
      const now = new Date().toISOString()
      const { error } = await admin
        .from("dropship_supplier_connections")
        .upsert({
          seller_id: user.id,
          supplier_key: key,
          supplier_name: supplierNames[key],
          status: "connected",
          connected_at: now,
          updated_at: now,
        }, { onConflict: "seller_id,supplier_key" })
      if (error) throw error
      return json({ success: true, supplier_key: key, supplier_name: supplierNames[key] })
    }

    if (action === "disconnect_supplier") {
      const key = supplierKey(body.supplier_key || body.supplier)
      const { error } = await admin
        .from("dropship_supplier_connections")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("seller_id", user.id)
        .eq("supplier_key", key)
      if (error) throw error
      return json({ success: true })
    }

    if (action === "list_catalog") {
      let query = admin
        .from("dropship_catalog")
        .select("id,supplier_key,supplier_name,niche,name,description,supplier_cost,suggested_price,shipping_cost,stock_quantity,delivery_estimate,demand,image_url")
        .eq("is_active", true)
        .order("demand", { ascending: true })

      if (body.niche && body.niche !== "all") query = query.eq("niche", String(body.niche))
      if (body.supplier_key && body.supplier_key !== "all") query = query.eq("supplier_key", supplierKey(body.supplier_key))

      const { data, error } = await query
      if (error) throw error
      return json({ success: true, catalog: data || [] })
    }

    // --- SMART RESILIENT URL SCRAPER GATEWAY WITH AUTOMATIC FALLBACK ---
    if (action === "import_from_url") {
      const url = String(body.url || "").trim()
      if (!url) throw new Error("Product URL is required")

      const apiKey = Deno.env.get("SCRAPER_API_KEY") || "your_scraper_api_free_key_here";
      let html = "";
      let res;

      // ATTEMPT 1: Try rendering dynamic scripts using a premium residential cluster
      try {
        console.log(`[SCRAPE ATTEMPT 1] Initializing optimized dynamic headless browser render...`)
        const browserUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}&render=true&premium=true&country_code=us&keep_headers=true`;
        res = await fetch(browserUrl)
        if (res.ok) html = await res.text()
      } catch (err) {
        console.warn("[SCRAPE WARNING] Headless cluster failed or timed out. Dropping to static residential fallback... Reason:", err.message)
      }

      // ATTEMPT 2 FALLBACK: If browser fails or throws a 500 error, run a fast raw text download pass
      if (!html || !res?.ok) {
        console.log(`[SCRAPE ATTEMPT 2] Executing fast raw residential proxy siphon fallback path...`)
        const rawUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}&premium=true&country_code=us`;
        res = await fetch(rawUrl)
        if (!res.ok) throw new Error(`Anti-bot block active. Both headless routing and raw residential data siphons failed. (Status ${res.status})`)
        html = await res.text()
      }

      const $ = cheerio.load(html)

      // Extract titles accurately from fully-rendered metadata trees or tag fallbacks
      let title = $('meta[property="og:title"]').attr('content') || 
                  $('h1.product-title').text().trim() || 
                  $('h1').text().trim()
                  
      title = title.replace(/\| AliExpress/ig, '').trim()
      
      if (!title || title.toLowerCase().includes('verification') || title.toLowerCase().includes('robot')) {
        throw new Error("Supplier firewall served a challenge window block. Re-run your layout query request.")
      }

      // Enforce strict name length caps on import to fit frontend validation bounds cleanly
      if (title.length > 100) {
        title = title.substring(0, 97) + "...";
      }

      // --- ADVANCED DYNAMIC PRICE EXTRACTION MATRIX ---
      let extractedPrice = 0;

      // Rule Module 1: Scan explicit OpenGraph meta definitions
      const metaPrice = $('meta[property="product:price:amount"]').attr('content') || 
                        $('meta[property="og:price:amount"]').attr('content');
      if (metaPrice) {
        extractedPrice = positiveNumber(metaPrice);
      }

      // Rule Module 2: Scan standard vendor DOM structures if meta data is missing
      if (extractedPrice === 0) {
        const priceSelectors = [
          '.product-price-value',
          '.uniform-price',
          '[itemprop="price"]',
          '.price-current',
          '.p-price',
          '.product-price'
        ].join(', ');

        const priceText = $(priceSelectors).first().text().trim();
        if (priceText) {
          const cleanedPrice = priceText.replace(/[^\d.]/g, '');
          extractedPrice = positiveNumber(cleanedPrice);
        }
      }

      // Rule Module 3: Deep regex scan scripts for hidden initial state values
      if (extractedPrice === 0) {
        $('script').each((_, scriptEl) => {
          const content = $(scriptEl).text();
          if (content.includes('formatedAmount') || content.includes('actMinPrice') || content.includes('activityValue') || content.includes('priceConfig')) {
            const priceMatch = content.match(/"formatedAmount"\s*:\s*"([^"]+)"/) || 
                               content.match(/"actMinPrice"\s*:\s*"([^"]+)"/) ||
                               content.match(/"activityValue"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/) ||
                               content.match(/"minPrice"\s*:\s*([\d.]+)/);
            if (priceMatch && priceMatch[1]) {
              extractedPrice = positiveNumber(priceMatch[1].replace(/[^\d.]/g, ''));
            }
          }
        });
      }

      const imageSet = new Set<string>()
      const videoSet = new Set<string>()

      const ogImg = $('meta[property="og:image"]').attr('content')
      if (ogImg) {
        let cleanOg = ogImg.trim();
        if (cleanOg.startsWith('//')) cleanOg = 'https:' + cleanOg;
        imageSet.add(cleanOg);
      }

      const selectors = [
        '.magnifier-image', 
        '.slider-img img',
        'img.product-img', 
        '.images-view-item img', 
        '.ui-image-slider img', 
        '.thumb-item img',
        '.detail-gallery-img'
      ].join(', ')

      $(selectors).each((_, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('image-src')
        if (src) {
          src = src.trim()
          if (src.startsWith('//')) src = 'https:' + src
          if (!src.includes('1x1') && !src.includes('pixel')) imageSet.add(src)
        }
      })

      $('video, video source, .video-player video').each((_, el) => {
        let videoSrc = $(el).attr('src') || $(el).attr('data-src')
        if (videoSrc) {
          videoSrc = videoSrc.trim()
          if (videoSrc.startsWith('//')) videoSrc = 'https:' + videoSrc
          videoSet.add(videoSrc)
        }
      })

      // --- FIXED MULTI-IMAGE & PROTOCOL SANITIZATION ---
      try {
        $('script').each((_, scriptEl) => {
          const content = $(scriptEl).text()
          if (content.includes('imagePathList') || content.includes('mediaList') || content.includes('runParams')) {
            const imgUrls = content.match(/"(https?:)?\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)\.(jpg|jpeg|png|webp)"/gi)
            if (imgUrls) {
              imgUrls.forEach(img => {
                let cleanedImg = img.replace(/"/g, '').trim()
                if (cleanedImg.startsWith('//')) {
                  cleanedImg = 'https:' + cleanedImg
                } else if (!cleanedImg.startsWith('http')) {
                  cleanedImg = 'https://' + cleanedImg
                }
                if (!cleanedImg.includes('1x1') && !cleanedImg.includes('pixel')) {
                  imageSet.add(cleanedImg)
                }
              })
            }
          }
        })
      } catch (_) {}

      const allImages = Array.from(imageSet)
      const allVideos = Array.from(videoSet)
      const mainImageUrl = allImages[0] || ''

// Enforce text matching constraints for newly mapped dropship suppliers
const supplierKeyStr = url.includes("aliexpress") ? "aliexpress" : 
                       url.includes("temu") ? "temu" : 
                       url.includes("amazon") ? "amazon" : "global"

      // Apply default markup margin to the extracted supplier base cost
      const baselineCost = extractedPrice;
      const calculatedRetailPrice = baselineCost > 0 ? Math.round(baselineCost * 1.6) : 0;

      const productPayload = {
        name: title,
        description: `Imported directly from ${supplierNames[supplierKeyStr] || "Supplier"}. URL: ${url}`,
        price: calculatedRetailPrice || baselineCost, 
        original_price: calculatedRetailPrice || baselineCost,
        category: "dropship",
        condition: "new",
        location: "International",
        image_url: mainImageUrl,
        images: allImages, 
        videos: allVideos,
        has_video: allVideos.length > 0,
        negotiable: false,
        stock_quantity: 999,
        seller_id: user.id,
        status: "draft", 
        is_dropship: true,
        dropship_supplier_key: supplierKeyStr,
        dropship_supplier_name: supplierNames[supplierKeyStr] || "Global Supplier",
        dropship_supplier_cost: baselineCost,
        dropship_shipping_cost: 0,
        dropship_delivery_estimate: "International shipping",
      }

      const product = await insertProduct(admin, productPayload)

      return json({ 
        success: true, 
        product_id: product.id, 
        name: title,
        images_found: allImages.length,
        videos_found: allVideos.length
      })
    }

    if (action === "import_product") {
      const catalogId = String(body.catalog_id || body.product_id || "")
      const overrides = body.data || {}
      let item: any = null

      if (catalogId) {
        const { data, error } = await admin
          .from("dropship_catalog")
          .select("*")
          .eq("id", catalogId)
          .eq("is_active", true)
          .single()
        if (error) throw error
        item = data
      } else {
        const key = supplierKey(overrides.supplier_key || "global")
        item = {
          id: null,
          supplier_key: key,
          supplier_name: supplierNames[key],
          name: overrides.name,
          description: overrides.description || "",
          supplier_cost: positiveNumber(overrides.supplier_cost || overrides.cost),
          suggested_price: positiveNumber(overrides.suggested_price || overrides.price),
          shipping_cost: positiveNumber(overrides.shipping_cost || overrides.shipping),
          stock_quantity: Number.parseInt(String(overrides.stock_quantity || overrides.stock || 999), 10) || 999,
          delivery_estimate: overrides.delivery_estimate || overrides.delivery || "International shipping",
          image_url: overrides.image_url || overrides.image || "",
        }
      }

      if (!item?.name) throw new Error("Dropship product name is required")
      const productPayload = catalogToProductPayload(item, user.id, overrides)
      const product = await insertProduct(admin, productPayload)

      await insertImport(admin, {
        seller_id: user.id,
        product_id: product.id,
        catalog_id: item.id,
        supplier_key: item.supplier_key || "global",
        supplier_name: item.supplier_name || "Global Supplier",
        supplier_cost: positiveNumber(item.supplier_cost),
        shipping_cost: positiveNumber(item.shipping_cost),
        suggested_price: positiveNumber(productPayload.price),
        delivery_estimate: item.delivery_estimate || "International shipping",
        status: "listed",
      })

      return json({ success: true, product_id: product.id })
    }

    throw new Error(`Unknown dropship action: ${action}`)
  } catch (error) {
    return fail(error)
  }
})