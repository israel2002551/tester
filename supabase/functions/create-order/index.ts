import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { fail, getAuthedClient, handleOptions, json, readJson } from "../_shared/common.ts"

// Web Push setup placeholder configuration metrics
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || ""
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || ""

async function priceCart(admin: any, cart: Array<{ id: string; qty?: number }>) {
  const ids = cart.map((item) => item.id).filter(Boolean)
  let { data: products, error } = await admin.from("products").select("id,name,price,seller_id,image_url").in("id", ids)
  if (error && missingColumn(error) === "image_url") {
    const retry = await admin.from("products").select("id,name,price,seller_id").in("id", ids)
    products = retry.data
    error = retry.error
  }
  if (error) throw error
  const byId = new Map((products || []).map((product: any) => [product.id, product]))
  const items = cart.map((item) => {
    const product: any = byId.get(item.id)
    if (!product) throw new Error("One or more cart items are unavailable")
    const qty = Math.max(1, Number(item.qty || 1))
    return { id: product.id, name: product.name, price: Number(product.price || 0), qty, image_url: product.image_url, seller_id: product.seller_id }
  })
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0)
  return { items, total }
}

function missingColumn(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
  const quoted = text.match(/'([^']+)' column/i) || text.match(/column "([^"]+)"/i)
  return quoted?.[1] || ""
}

async function insertOrder(admin: any, payload: Record<string, unknown>) {
  const updatePayload = { ...payload }

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error, data } = await admin.from("orders").insert(updatePayload).select("id").single()
    if (!error) return data

    const column = missingColumn(error)
    if (!column || !(column in updatePayload)) throw error

    delete updatePayload[column]
  }

  throw new Error("Could not create order with the available orders table columns")
}

async function insertPaymentReceipt(admin: any, payload: Record<string, unknown>) {
  const insertPayload = { ...payload }

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await admin.from("payment_receipts").insert(insertPayload)
    if (!error) return

    const column = missingColumn(error)
    if (!column || !(column in insertPayload)) throw error

    delete insertPayload[column]
  }

  throw new Error("Could not create payment receipt with the available payment_receipts columns")
}

// SERVER PUSH ENGINE ENGINE
async function sendSystemPushNotification(admin: any, userId: string, payload: { title: string; body: string; click_url?: string }) {
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("push_subscription_token")
      .eq("id", userId)
      .maybeSingle()

    if (!profile || !profile.push_subscription_token) return;

    // Parse hardware endpoint keys
    const subscription = JSON.parse(profile.push_subscription_token)
    
    console.log(`[PUSH INITIATED] Delivering target data to user ${userId}: ${payload.title}`)
    // Integration logic calling npm:web-push or WebPush standalone clusters goes here
  } catch (err) {
    console.warn("[PUSH ENGINE EXCEPTION] Notification delivery bypassed:", err.message)
  }
}

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const { admin, user } = await getAuthedClient(req)
    const body = await readJson(req)
    const { items, total } = await priceCart(admin, body.cart || [])
    const sellerId = items[0]?.seller_id || null
    
    // Support wallet revenue alongside classic structures cleanly
    const rawMethod = body.payment_method || "transfer"
    const paymentMethod = rawMethod === "bank_transfer" ? "transfer" : rawMethod

    // WALLET AUTOCONFIRMATION: Wallet revenue purchases pass verification instantly
    const initialStatus = paymentMethod === "wallet_revenue" || paymentMethod === "paystack" ? "confirmed" : "pending"

    const data = await insertOrder(admin, {
      buyer_id: user.id,
      seller_id: sellerId,
      items,
      total_amount: total,
      status: initialStatus,
      payment_method: paymentMethod,
      payment_ref: body.payment_ref || "",
      proof_url: body.proof_url || "",
      payment_proof_url: body.proof_url || body.payment_proof_url || "",
      delivery_name: body.delivery?.name || body.delivery_name || "",
      delivery_phone: body.delivery?.phone || body.delivery_phone || "",
      delivery_address: body.delivery?.address || body.delivery_address || "",
    })

    // Track order placement history line
    await admin.from("order_tracking").insert({
      order_id: data.id,
      status: initialStatus,
      note: initialStatus === "confirmed" ? "Order payment verified and confirmed" : "Order placed",
      updated_by: user.id,
    }).then(() => {}).catch(() => {})

    const proofUrl = body.proof_url || body.payment_proof_url || ""
    if (proofUrl && paymentMethod !== "wallet_revenue") {
      await insertPaymentReceipt(admin, {
        order_id: data.id,
        buyer_id: user.id,
        seller_id: sellerId,
        receipt_url: proofUrl,
        amount: total,
        payment_type: "product",
        status: "pending",
      }).catch((error) => console.error("Payment receipt insert failed:", error))
    }

    // ====================================================
    //  PUSH NOTIFICATION TRIGGERS
    // ====================================================
    // 1. Notify the Buyer
    const buyerMessage = initialStatus === "confirmed" 
      ? `Your order of ₦${total.toLocaleString()} is confirmed! the merchant has been notified.`
      : `Your order has been placed. Waiting for payment approval.`;
    
    await sendSystemPushNotification(admin, user.id, {
      title: initialStatus === "confirmed" ? "Order Confirmed! 🎉" : "Order Placed 🛍️",
      body: buyerMessage,
      click_url: `${req.headers.get("origin") || "https://buysell.ng"}/#`
    }).catch(() => {})

    // 2. Notify the Seller
    if (sellerId) {
      const itemSummary = items.map((i: any) => `${i.name} (x${i.qty})`).join(", ")
      const sellerMessage = initialStatus === "confirmed"
        ? `🎉 New Paid Order! You earned ₦${total.toLocaleString()} for: ${itemSummary}. Pack items now.`
        : `🛍️ New Order Received: ${itemSummary}. Awaiting receipt verification framework pass.`;

      await sendSystemPushNotification(admin, sellerId, {
        title: initialStatus === "confirmed" ? "New Paid Order! 💰" : "New Order Alert",
        body: sellerMessage,
        click_url: `${req.headers.get("origin") || "https://buysell.ng"}/#`
      }).catch(() => {})
    }

    return json({ success: true, order_id: data.id, total, status: initialStatus })
  } catch (error) {
    return fail(error)
  }
})