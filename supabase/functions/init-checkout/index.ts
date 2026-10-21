import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { fail, getAuthedClient, handleOptions, json, readJson } from "../_shared/common.ts"

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const { admin, user } = await getAuthedClient(req)
    const body = await readJson(req)
    const ids = (body.cart || []).map((item: any) => item.id).filter(Boolean)
    const { data: products, error } = await admin.from("products").select("id,price").in("id", ids)
    if (error) throw error
    const byId = new Map((products || []).map((product: any) => [product.id, Number(product.price || 0)]))
    const total = (body.cart || []).reduce((sum: number, item: any) => sum + (byId.get(item.id) || 0) * Math.max(1, Number(item.qty || 1)), 0)
    const amountKobo = Math.round(total * 100)
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY")

    if (!paystackSecret) throw new Error("PAYSTACK_SECRET_KEY is not configured")

    const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, amount: amountKobo, metadata: { user_id: user.id, cart: body.cart || [] } }),
    })
    const initData = await initRes.json()
    if (!initRes.ok) throw new Error(initData?.message || "Paystack initialization failed")
    return json({
      success: true,
      amount_kobo: amountKobo,
      access_code: initData.data?.access_code || "",
      authorization_url: initData.data?.authorization_url || "",
      reference: initData.data?.reference || "",
    })
  } catch (error) {
    return fail(error)
  }
})
