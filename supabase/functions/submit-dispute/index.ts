import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { fail, getAuthedClient, handleOptions, json, readJson } from "../_shared/common.ts"

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const { admin, user } = await getAuthedClient(req)
    const body = await readJson(req)

    // 1. Fetch the original order to get the required fields
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("seller_id, total_amount")
      .eq("id", body.order_id)
      .single()

    if (orderError || !order) {
      throw new Error("Could not find order or order access denied")
    }

    // 2. Perform the insert with all required fields
    const { error, data } = await admin.from("disputes").insert({
      order_id: body.order_id,
      buyer_id: user.id,
      seller_id: order.seller_id,        // REQUIRED: Fetched from orders
      total_amount: order.total_amount,  // REQUIRED: Fetched from orders
      discount_amount: 0,                // REQUIRED: Default to 0
      dispute_type: body.dispute_type || body.type || "general",
      description: body.description || "",
      status: "open",
    }).select("id").single()

    if (error) throw error
    
    return json({ success: true, dispute_id: data.id })
    
  } catch (error) {
    console.error("Dispute Function Error:", error);
    return fail(error)
  }
})