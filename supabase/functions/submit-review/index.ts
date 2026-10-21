import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { fail, getAuthedClient, handleOptions, json, readJson } from "../_shared/common.ts"

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const { admin, user } = await getAuthedClient(req)
    const body = await readJson(req)
    const rating = Number(body.rating)
    if (rating < 1 || rating > 5) throw new Error("Rating must be between 1 and 5")

    const { data: product } = await admin.from("products").select("seller_id").eq("id", body.product_id).single()
    const text = body.review_text || body.text || body.comment || ""
    const base = {
      product_id: body.product_id,
      reviewer_id: user.id,
      buyer_id: user.id,
      seller_id: product?.seller_id || null,
      rating,
      verified_purchase: Boolean(body.verified_purchase),
    }
    const variants = [
      { ...base, review_text: text, image_urls: body.image_urls || [] },
      { ...base, review_text: text },
      { ...base, comment: text },
      { product_id: body.product_id, reviewer_id: user.id, rating, comment: text },
      { product_id: body.product_id, buyer_id: user.id, rating, comment: text },
      { product_id: body.product_id, user_id: user.id, rating, comment: text },
    ]

    let lastError: any = null
    for (const row of variants) {
      const { error, data } = await admin.from("reviews").insert(row).select("id").single()
      if (!error) return json({ success: true, review_id: data.id })
      lastError = error
      const msg = String(error.message || "").toLowerCase()
      if (!msg.includes("column") && !msg.includes("schema cache")) break
    }
    throw lastError
  } catch (error) {
    return fail(error)
  }
})
