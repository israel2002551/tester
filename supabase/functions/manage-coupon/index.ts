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
  if (error instanceof Error) {
    message = error.message
  } else if (error && typeof error === "object" && "message" in error) {
    message = String((error as any).message)
  } else if (typeof error === "string") {
    message = error
  }
  console.error("Manage coupon error:", JSON.stringify(error, null, 2))
  return json({ error: message }, 400)
}

function normalizeCode(code: unknown) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
}

function positiveNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function friendlyCouponError(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""}`.toLowerCase()
  if (text.includes("coupons_seller_code_unique") || text.includes("duplicate key")) {
    return new Error("You already have a coupon with that code")
  }
  return error
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

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const { admin, user } = await getAuthedClient(req)
    await ensureSellerProfile(admin, user.id)
    const body = await readJson(req)
    const action = body.action

    if (action === "list") {
      const { data, error } = await admin
        .from("coupons")
        .select("id,code,discount_type,discount_value,min_order,max_uses,used_count,expires_at,is_active,created_at")
        .eq("seller_id", user.id)
        .order("created_at", { ascending: false })
      if (error) throw error
      return json({ success: true, coupons: data || [] })
    }

    if (action === "create") {
      const input = body.data || {}
      const code = normalizeCode(input.code)
      const discountType = input.discount_type === "fixed" ? "fixed" : "percent"
      const discountValue = positiveNumber(input.discount_value)
      const minOrder = Math.max(0, positiveNumber(input.min_order))
      const maxUses = positiveInt(input.max_uses, 100)
      const expiresAt = input.expires_at ? new Date(input.expires_at) : null

      if (!code) throw new Error("Coupon code is required")
      if (code.length < 3 || code.length > 32) throw new Error("Coupon code must be 3 to 32 characters")
      if (discountValue <= 0) throw new Error("Discount value must be greater than zero")
      if (discountType === "percent" && discountValue > 100) throw new Error("Percentage coupons cannot exceed 100%")
      if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("Coupon expiry date is invalid")

      const { data, error } = await admin
        .from("coupons")
        .insert({
          seller_id: user.id,
          code,
          discount_type: discountType,
          discount_value: discountValue,
          min_order: minOrder,
          max_uses: maxUses,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
          is_active: true,
        })
        .select("id")
        .single()
      if (error) throw friendlyCouponError(error)

      return json({ success: true, coupon_id: data.id, code })
    }

    if (action === "delete") {
      const couponId = String(body.coupon_id || "")
      if (!couponId) throw new Error("Coupon id is required")

      const { error, count } = await admin
        .from("coupons")
        .delete({ count: "exact" })
        .eq("id", couponId)
        .eq("seller_id", user.id)
      if (error) throw error
      if (count === 0) throw new Error("Coupon not found or you do not have permission to delete it")

      return json({ success: true })
    }

    throw new Error(`Unknown coupon action: ${action}`)
  } catch (error) {
    return fail(error)
  }
})
