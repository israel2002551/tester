import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { fail, handleOptions, json, readJson } from "../_shared/common.ts"

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const body = await readJson(req)
    const messages = body.systemPrompt
      ? [{ role: "system", content: body.systemPrompt }, ...(body.messages || [])]
      : body.messages || []
    const apiKey = Deno.env.get("GROQ_API_KEY")
    const last = messages[messages.length - 1]?.content || ""

    if (!apiKey) {
      return json({ success: true, reply: fallbackReply(last) })
    }

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile",
          messages,
          temperature: 0.4,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error("Groq API error:", data?.error?.message || res.status)
        return json({ success: true, reply: fallbackReply(last) })
      }
      return json({ success: true, reply: data.choices?.[0]?.message?.content || "" })
    } catch (groqError) {
      console.error("Groq fetch error:", groqError)
      return json({ success: true, reply: fallbackReply(last) })
    }
  } catch (error) {
    return fail(error)
  }
})

function fallbackReply(message: string) {
  const text = message.toLowerCase()
  if (text.includes("order") || text.includes("track")) return "You can track an order from My Orders, then tap Track. Sellers can update tracking from Orders with Add Update."
  if (text.includes("kyc")) return "KYC is reviewed by the admin from the KYC Verify tab. Open the submitted documents, then approve or reject the user."
  if (text.includes("ad")) return "Ads can be created from the Advertise section. After payment is verified, active ads show in your ads table and impressions/clicks are tracked."
  return "AI is running in basic help mode because GROQ_API_KEY is not configured. I can still help with shopping, orders, KYC, ads, and seller dashboard steps."
}
