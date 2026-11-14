// Search by photo: a shopper's photo goes in, a short shop search comes out
// ("black leather handbag"), which the marketplace then runs like a typed search.
//
// The photo is only passed to the vision model. It is never stored or logged.
// Each visitor may run a limited number of photo searches (see
// public.buysell_take_image_search), because the Groq key is shared with the
// WhatsApp bots and must not be used up by one visitor.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORIES = new Set(["electronics", "phones", "fashion", "home", "beauty", "sports", "arts", "other"]);
const AUDIENCES = new Set(["men", "women", "unisex", "kids"]);
// A phone photo resized by the site is about 150-400 KB; this is a generous ceiling.
const MAX_IMAGE_CHARS = 2_500_000;
const PER_VISITOR_PER_HOUR = 20;
const ALL_VISITORS_PER_DAY = 1500;

const PROMPT = `You help shoppers on BUYSELL, a Nigerian online marketplace, find products like the one in their photo.

Look at the photo and pick the one main product a shopper would want to buy. If a person is in the photo, describe what they are wearing or holding, never the person.

Return only JSON:
{
  "found": true or false (false when there is no product to buy, e.g. a blank image, a screenshot of text, a landscape),
  "item": the kind of product in 1 to 3 plain words, as a Nigerian seller would title it, e.g. "handbag", "sneakers", "gown", "air fryer", "iphone", "perfume", "standing fan",
  "query": a 2 to 6 word shop search for it: the colour, material or brand when clearly visible, then the item, e.g. "black leather handbag", "white nike sneakers", "red ankara gown", "silver iphone 13",
  "category": one of "electronics", "phones", "fashion", "home", "beauty", "sports", "arts", "other",
  "audience": "men", "women", "unisex" or "kids" for clothes, shoes, bags, jewellery and beauty products when it is clear, otherwise null,
  "brand": the brand when a logo or name is clearly visible, otherwise null,
  "colors": up to 2 main colours, e.g. ["black", "gold"]
}
Never guess a brand from style alone. Use simple everyday words.`;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f<>"`\\{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

// A provider's failure. `summary` (status and error code, never the message,
// which can quote part of an API key) is returned to the caller for diagnosis.
class ProviderError extends Error {
  summary: string;
  constructor(message: string, summary: string) {
    super(message);
    this.summary = summary;
  }
}

function providerError(provider: string, status: number, body: Record<string, any>) {
  const code = text(body?.error?.code || body?.error?.type, 40);
  return new ProviderError(`${provider} returned ${status}: ${text(body?.error?.message, 160)}`, `${status}${code ? ` ${code}` : ""}`);
}

function parseJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  const parsed = JSON.parse(candidate);
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

/** The model's answer, cleaned up, or null when it gave nothing usable. */
function readAnswer(answer: Record<string, unknown>) {
  const item = text(answer.item, 40).toLowerCase();
  const query = text(answer.query, 80).toLowerCase() || item;
  const found = answer.found !== false && Boolean(item || query);
  if (!found) return { found: false };
  const category = text(answer.category, 20).toLowerCase();
  const audience = text(answer.audience, 10).toLowerCase();
  const colors = (Array.isArray(answer.colors) ? answer.colors : [])
    .map((color) => text(color, 20).toLowerCase())
    .filter(Boolean)
    .slice(0, 2);
  return {
    found: true,
    item: item || query,
    query,
    category: CATEGORIES.has(category) ? category : null,
    audience: AUDIENCES.has(audience) ? audience : null,
    brand: text(answer.brand, 40) || null,
    colors,
  };
}

async function askGroq(image: string, model: string) {
  const key = Deno.env.get("GROQ_API_KEY") || "";
  if (!key) throw new ProviderError("GROQ_API_KEY is not set", "no key");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: [{ type: "text", text: "What product is this?" }, { type: "image_url", image_url: { url: image } }] },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(`Groq ${model}`, response.status, body);
  return parseJson(String(body?.choices?.[0]?.message?.content || "{}"));
}

async function askOpenAi(image: string) {
  const key = Deno.env.get("OPENAI_API_KEY") || "";
  if (!key) throw new ProviderError("OPENAI_API_KEY is not set", "no key");
  const model = Deno.env.get("OPENAI_SEARCH_MODEL") || "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [{ type: "input_text", text: PROMPT }, { type: "input_image", image_url: image }],
      }],
    }),
    signal: AbortSignal.timeout(40_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(`OpenAI ${model}`, response.status, body);
  let output = typeof body.output_text === "string" ? body.output_text : "";
  if (!output) {
    for (const item of Array.isArray(body.output) ? body.output : []) {
      for (const block of Array.isArray(item?.content) ? item.content : []) {
        if (typeof block?.text === "string") output += block.text;
      }
    }
  }
  return parseJson(output || "{}");
}

/** Groq first (fast and cheap), then OpenAI. */
async function describePhoto(image: string) {
  const groqModels = [
    ...String(Deno.env.get("GROQ_VISION_MODEL") || "").split(","),
    "qwen/qwen3.8-27b",
  ].map((model) => model.trim()).filter((model, index, all) => model && all.indexOf(model) === index);
  const attempts: Array<[string, () => Promise<Record<string, unknown>>]> = [
    ...groqModels.map((model) => [`groq:${model}`, () => askGroq(image, model)] as [string, () => Promise<Record<string, unknown>>]),
    ["openai", () => askOpenAi(image)],
  ];
  const failures: string[] = [];
  for (const [source, attempt] of attempts) {
    try {
      return { source, answer: readAnswer(await attempt()), failures };
    } catch (error) {
      console.warn(`[image-search] ${source} failed: ${error instanceof Error ? error.message : error}`);
      const summary = error instanceof ProviderError ? error.summary
        : error instanceof SyntaxError ? "unreadable reply"
        : error instanceof DOMException && error.name === "TimeoutError" ? "timed out"
        : "failed";
      failures.push(`${source}: ${summary}`);
    }
  }
  return { source: null, answer: null, failures };
}

// Fallback when the limits table is missing: per server instance only.
const memoryLimits = new Map<string, number[]>();
function takeFromMemory(client: string) {
  const now = Date.now();
  const recent = (memoryLimits.get(client) || []).filter((time) => now - time < 3_600_000);
  if (recent.length >= PER_VISITOR_PER_HOUR) return false;
  recent.push(now);
  memoryLimits.set(client, recent);
  return true;
}

async function clientHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "unknown";
  // Keyed, so the stored value cannot be turned back into an IP address.
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "buysell";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`image-search:${ip}`));
  return [...new Uint8Array(signature)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function allowed(req: Request) {
  const client = await clientHash(req);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
      auth: { persistSession: false },
    });
    const { data, error } = await admin.rpc("buysell_take_image_search", {
      p_client_hash: client,
      p_per_hour: PER_VISITOR_PER_HOUR,
      p_per_day: ALL_VISITORS_PER_DAY,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    console.warn(`[image-search] limits table unavailable, using memory: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    return takeFromMemory(client);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send the photo as JSON." }, 400);
  }
  const image = typeof body.image === "string" ? body.image : "";
  if (image.length > MAX_IMAGE_CHARS) return json({ error: "That photo is too large. Try a smaller one." }, 413);
  const header = image.match(/^data:image\/(jpeg|png|webp);base64,/)?.[0] || "";
  if (!header || image.length < header.length + 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.slice(header.length))) {
    return json({ error: "Choose a photo (JPG, PNG or WebP)." }, 400);
  }

  if (!(await allowed(req))) {
    return json({ error: "You've run a lot of photo searches. Please try again in a little while." }, 429);
  }

  const result = await describePhoto(image);
  if (!result.answer) {
    return json({ error: "Photo search isn't available right now. Please type your search instead.", tried: result.failures }, 503);
  }
  return json({ ...result.answer, source: result.source });
});
