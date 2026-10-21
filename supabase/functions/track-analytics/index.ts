import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const allowedEvents = new Set(["product_view", "store_view", "add_to_cart", "checkout_started", "order_created"])

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
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Analytics tracking failed"
  console.error("Track analytics error:", JSON.stringify(error, null, 2))
  return json({ error: message }, 400)
}

async function getOptionalUser(admin: any, req: Request) {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.replace("Bearer ", "")
  if (!token) return null

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (anonKey && token === anonKey) return null

  const { data: { user } } = await admin.auth.getUser(token)
  return user || null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function environment is not configured")

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const body = await readJson(req)
    const eventType = String(body.event_type || "")
    if (!allowedEvents.has(eventType)) throw new Error("Unknown analytics event")

    const user = await getOptionalUser(admin, req)
    let sellerId = body.seller_id ? String(body.seller_id) : ""
    const productId = body.product_id ? String(body.product_id) : null

    if (!sellerId && productId) {
      const { data, error } = await admin
        .from("products")
        .select("seller_id")
        .eq("id", productId)
        .maybeSingle()
      if (error) throw error
      sellerId = data?.seller_id || ""
    }

    if (!sellerId && body.order_id) {
      const { data, error } = await admin
        .from("orders")
        .select("seller_id")
        .eq("id", String(body.order_id))
        .maybeSingle()
      if (error) throw error
      sellerId = data?.seller_id || ""
    }

    if (!sellerId) throw new Error("Seller could not be resolved for analytics event")

    const { error } = await admin.from("seller_analytics_events").insert({
      seller_id: sellerId,
      buyer_id: user?.id || body.buyer_id || null,
      product_id: productId,
      order_id: body.order_id || null,
      event_type: eventType,
      quantity: Math.max(1, Number.parseInt(String(body.quantity || 1), 10) || 1),
      amount: Math.max(0, Number(body.amount || 0)),
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      session_id: String(body.session_id || ""),
      user_agent: req.headers.get("user-agent") || "",
    })
    if (error) throw error

    return json({ success: true })
  } catch (error) {
    return fail(error)
  }
})
