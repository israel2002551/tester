import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Seller analytics failed"
  console.error("Seller analytics error:", JSON.stringify(error, null, 2))
  return json({ error: message }, 400)
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

async function ensureSellerProfile(admin: any, userId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()
  if (error) throw error
  if (data?.role !== "seller" && data?.role !== "admin") throw new Error("Forbidden: Seller access required")
}

function emptySeries(days: number) {
  const map: Record<string, { date: string; views: number; carts: number; checkouts: number; orders: number; revenue: number }> = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    map[key] = { date: key, views: 0, carts: 0, checkouts: 0, orders: 0, revenue: 0 }
  }
  return map
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { admin, user } = await getAuthedClient(req)
    await ensureSellerProfile(admin, user.id)
    const body = await readJson(req)
    const days = Math.min(365, Math.max(7, Number.parseInt(String(body.days || 30), 10) || 30))
    const since = new Date()
    since.setDate(since.getDate() - days)

    const { data: products, error: productError } = await admin
      .from("products")
      .select("id,name,price,status,created_at")
      .eq("seller_id", user.id)
    if (productError) throw productError

    const productIds = (products || []).map((product: any) => product.id)

    const { data: events, error: eventError } = await admin
      .from("seller_analytics_events")
      .select("event_type,product_id,order_id,quantity,amount,session_id,created_at")
      .eq("seller_id", user.id)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
    if (eventError) throw eventError

    const { data: orders, error: orderError } = await admin
      .from("orders")
      .select("id,total_amount,status,created_at,items")
      .eq("seller_id", user.id)
      .gte("created_at", since.toISOString())
    if (orderError) throw orderError

    const { data: reviews, error: reviewError } = productIds.length
      ? await admin.from("reviews").select("rating,product_id,created_at").in("product_id", productIds)
      : { data: [], error: null }
    if (reviewError) throw reviewError

    const seriesMap = emptySeries(days)
    const totals = { views: 0, carts: 0, checkouts: 0, orders: 0, revenue: 0, reviews: (reviews || []).length }
    const uniqueViewSessions = new Set<string>()
    const productStats = new Map<string, { id: string; name: string; views: number; carts: number; orders: number; revenue: number }>()

    for (const product of products || []) {
      productStats.set(product.id, { id: product.id, name: product.name || "Product", views: 0, carts: 0, orders: 0, revenue: 0 })
    }

    for (const event of events || []) {
      const key = event.created_at?.slice(0, 10)
      const bucket = seriesMap[key]
      const qty = Number(event.quantity || 1)
      const amount = Number(event.amount || 0)
      const stat = event.product_id ? productStats.get(event.product_id) : null

      if (event.event_type === "product_view" || event.event_type === "store_view") {
        totals.views += qty
        if (bucket) bucket.views += qty
        if (event.session_id) uniqueViewSessions.add(`${event.event_type}:${event.product_id || "store"}:${event.session_id}`)
        if (stat) stat.views += qty
      }
      if (event.event_type === "add_to_cart") {
        totals.carts += qty
        if (bucket) bucket.carts += qty
        if (stat) stat.carts += qty
      }
      if (event.event_type === "checkout_started") {
        totals.checkouts += qty
        if (bucket) bucket.checkouts += qty
      }
      if (event.event_type === "order_created") {
        totals.orders += qty
        totals.revenue += amount
        if (bucket) {
          bucket.orders += qty
          bucket.revenue += amount
        }
        if (stat) {
          stat.orders += qty
          stat.revenue += amount
        }
      }
    }

    for (const order of orders || []) {
      if (order.status === "cancelled" || order.status === "refunded") continue
      const hasTracked = (events || []).some((event: any) => event.event_type === "order_created" && event.order_id === order.id)
      if (!hasTracked) {
        totals.orders += 1
        totals.revenue += Number(order.total_amount || 0)
        const key = order.created_at?.slice(0, 10)
        if (seriesMap[key]) {
          seriesMap[key].orders += 1
          seriesMap[key].revenue += Number(order.total_amount || 0)
        }
      }
    }

    const avgRating = (reviews || []).length
      ? (reviews || []).reduce((sum: number, review: any) => sum + Number(review.rating || 0), 0) / (reviews || []).length
      : 0
    const conversionRate = totals.views > 0 ? (totals.orders / totals.views) * 100 : 0
    const cartRate = totals.views > 0 ? (totals.carts / totals.views) * 100 : 0

    const topProducts = [...productStats.values()]
      .sort((a, b) => (b.revenue - a.revenue) || (b.views - a.views))
      .slice(0, 8)

    return json({
      success: true,
      days,
      totals: {
        ...totals,
        unique_views: uniqueViewSessions.size,
        conversion_rate: Number(conversionRate.toFixed(2)),
        cart_rate: Number(cartRate.toFixed(2)),
        average_rating: Number(avgRating.toFixed(1)),
        product_count: (products || []).length,
        active_products: (products || []).filter((product: any) => product.status === "active").length,
      },
      series: Object.values(seriesMap),
      top_products: topProducts,
    })
  } catch (error) {
    return fail(error)
  }
})
