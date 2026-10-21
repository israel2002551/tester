import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleOptions, json, readJson, fail } from "../_shared/common.ts"

serve(async (req) => {
  const options = handleOptions(req)
  if (options) return options

  try {
    const body = await readJson(req)
    const task = body.context?.task || ""
    const last = body.messages?.[body.messages.length - 1]?.content || ""
    const apiKey = Deno.env.get("GROQ_API_KEY")

    if (!apiKey) {
      return json({ reply: fallbackReply(task, last) })
    }

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile",
          messages: body.messages || [],
          temperature: 0.5,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error("Groq API error:", data?.error?.message || res.status)
        // Gracefully fall back instead of failing the entire request
        return json({ reply: fallbackReply(task, last) })
      }
      return json({ reply: data.choices?.[0]?.message?.content || fallbackReply(task, last) })
    } catch (groqError) {
      console.error("Groq fetch error:", groqError)
      // Network/timeout error — still return a usable response
      return json({ reply: fallbackReply(task, last) })
    }
  } catch (error) {
    return fail(error)
  }
})

function fallbackReply(task: string, message: string) {
  if (task === "product_description") {
    const match = message.match(/Product:\s*(.+)/i)
    const product = match?.[1]?.trim() || "This item"
    return `${product} is a quality product available for buyers in Nigeria. It offers dependable value, a clean presentation, and practical everyday usefulness for anyone looking for a trustworthy purchase.`
  }
  if (task === "search_suggestion") return "phones, fashion, laptop"
  if (task === "admin_assistant") {
    const text = message.toLowerCase()
    if (text.includes("receipt") || text.includes("commission")) return "Open Account Management to review pending commission receipts. Confirm the payment proof, then approve to activate the account or reject with a clear reason."
    if (text.includes("kyc")) return "Use the KYC Verify tab to inspect uploaded documents, then approve only when the identity details match the user profile."
    if (text.includes("dispute")) return "Open Disputes, compare the order record with buyer and seller evidence, then resolve or escalate based on the proof."
    return "Admin AI is running in basic mode because GROQ_API_KEY is not configured. I can still guide you through receipts, KYC, disputes, ads, and account enforcement."
  }
  return "AI is in basic mode because GROQ_API_KEY is not configured, but the assistant endpoint is reachable."
}
