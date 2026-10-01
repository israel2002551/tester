import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PROMPT_TEMPLATE = `
You extract marketplace listing fields from a WhatsApp sale post for BUYSELL Nigeria.
Return is_commercial_listing=true only when a person is offering a specific item or service for sale. Return false for chats, requests to buy, news, memes, religious posts, complaints, and vague promotions.

Return exactly one JSON object with these keys:
- is_commercial_listing: boolean
- title: concise product title, maximum 80 characters, or empty string
- price: whole Nigerian naira amount as a number, or null when there is no stated fixed price. Expand 350k to 350000 and 1.5m to 1500000.
- category: one of "Phones & Tablets", "Computers & Laptops", "Electronics", "Vehicles", "Fashion", "Home & Furniture", "Beauty & Health", "Services", "Other"
- condition: one of "brand_new", "foreign_used", "local_used", "refurbished", "unknown"
- brand: manufacturer/brand or null
- location: city, area, campus, or town or null
- seller_phone: Nigerian seller phone digits only or null
- specs: short factual specification summary or null

Do not invent price, condition, contact details, availability, or product facts. Output only JSON.
`;

const FALLBACK_MODELS = [
  process.env.GROQ_MODEL,
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
].filter(Boolean);

let activeModel = FALLBACK_MODELS[0];

export async function parseListingWithGroq(text) {
  const message = String(text || '').trim();
  if (message.length < 6) return { is_commercial_listing: false };

  // Try the last successful or preferred model first, then fall back
  const modelsToTry = [activeModel, ...FALLBACK_MODELS.filter((m) => m !== activeModel)];

  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: PROMPT_TEMPLATE },
          { role: 'user', content: `WhatsApp post:\n"""${message}"""` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600,
      });
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      if (parsed && typeof parsed === 'object') {
        activeModel = model;
        return parsed;
      }
    } catch (error) {
      console.warn(`[Groq parser] Model ${model} failed (${error?.message || error}), trying fallback...`);
    }
  }

  console.error('[Groq parser] All candidate models failed to parse listing.');
  return null;
}

export function looksLikeSalePost(text) {
  const source = String(text || '').toLowerCase();
  return /(?:\bfor sale\b|\bavailable\b|\bselling\b|\bprice\b|\b\d+(?:[.,]\d+)?\s*[km]\b|₦|\bngn\b|\bnego\b|\bforeign used\b|\btokunbo\b|\bdm\b|\bcall\b)/i.test(source);
}
