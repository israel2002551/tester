import Groq from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'not_configured' });

export function stripPriceFromText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Remove "Price: 350k", "Cost: ₦50,000", "Going for 1.5m", "last price 25k", etc.
    .replace(/(?:\bprice\b|\basking\b|\bcost\b|\bgoing for\b|\bselling for\b|\blast price\b)\s*[:=-]?\s*(?:₦|NGN)?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/gi, '')
    // Remove remaining price phrases like "last price", "asking price"
    .replace(/\b(?:last|asking)\s+price\b/gi, '')
    // Remove Naira symbols and following numbers e.g. ₦50,000, ₦ 350k
    .replace(/₦\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/gi, '')
    // Remove NGN numbers e.g. NGN 50,000
    .replace(/\bngn\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/gi, '')
    // Remove standalone shorthand e.g. 350k, 45k, 1.5m, 2.5M
    .replace(/(^|\s)\d+(?:[.,]\d+)?\s*[kKmM]\b/gi, '$1')
    // Remove standalone amounts with 4-9 digits if preceded by sale words
    .replace(/(?:\bfor\b|\bat\b|\b#)\s*[\d,]{4,10}\b/gi, '')
    // Clean up repetitive or orphaned punctuation
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([.,;:!?-])\s*([.,;:!?-])+/g, '$1')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/^\s*[,:;-]\s*/gm, '')
    .replace(/\s*[,:;-]\s*$/gm, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

export function hasPriceInText(text) {
  const source = String(text || '').trim();
  return /(?:\b\d+(?:[.,]\d+)?\s*[km]\b|₦|\bngn\b|\b\d{4,9}\b)/i.test(source);
}

const PROMPT_TEMPLATE = `
You extract marketplace listing fields from WhatsApp sale posts and product images for BUYSELL Nigeria.

A WhatsApp post may contain ONE product or A LIST OF MULTIPLE PRODUCTS being offered for sale (e.g. inventory catalogs, multiple items with distinct prices, or multiple items pictured in photos).

CRITICAL STRICT RULES:
1. DESCRIPTION AND TITLE MUST NEVER CONTAIN THE PRICE, CURRENCY, OR PAYMENT TERMS:
   Under NO circumstance should the price, currency (₦, Naira, NGN), or amount figures (e.g. "350k", "₦50,000", "1.5m", "45,000") appear in the 'title' or 'description'. Prices belong EXCLUSIVELY in the 'price' field.
   The description must focus entirely on what the item is: brand, model, color, physical condition, aesthetics, specifications, materials, and included accessories.
2. MULTI-PRODUCT PARSING:
   - If the post contains ONE product, return an "items" array with 1 item object.
   - If the post contains SEVERAL products (e.g. "1. iPhone 11 - 220k, 2. iPhone 12 - 340k"), extract EACH distinct product as a separate object in the "items" array.
   - Do NOT merge multiple different products into one item.
3. PRICE EXTRACTION:
   - Extract the exact numeric price for EACH item from text or flyer image.
   - Expand Nigerian shorthand: "350k" -> 350000, "1.5m" -> 1500000, "45k" -> 45000, "₦60,000" -> 60000.
   - Do not invent a price if none was stated in text or visible in the image. Set price to null if not found.

Return exactly one JSON object with these keys:
- is_commercial_listing: boolean (true if one or more commercial items/services are offered for sale; false for general chat, memes, complaints, requests to buy)
- seller_phone: Nigerian seller phone digits only or null
- location: city, area, campus, or town or null
- items: array of product objects, where each object has:
  * title: concise, attractive product title (maximum 80 characters, NO price)
  * description: clear, appealing product description (1-3 sentences detailing features/condition, STRICTLY NO price or currency figures)
  * price: whole Nigerian naira amount as a number, or null when there is no stated fixed price
  * category: one of "Phones & Tablets", "Computers & Laptops", "Electronics", "Vehicles", "Fashion", "Home & Furniture", "Beauty & Health", "Services", "Other"
  * condition: one of "brand_new", "foreign_used", "local_used", "refurbished", "unknown"
  * brand: manufacturer/brand or null
  * specs: short factual specification summary or null
  * image_index: 0-based index of the matching image, or 0 if single item or all photos belong to it

Output only JSON.
`;

const VISION_MODELS = [
  process.env.GROQ_MODEL,
  'qwen/qwen3.8-27b',
].filter(Boolean);

const FALLBACK_TEXT_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

function normalizeParsedResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  let items = Array.isArray(parsed.items) && parsed.items.length > 0
    ? parsed.items
    : (parsed.title || parsed.price ? [parsed] : []);

  // Sanitize each item: ensure prices are numbers and strip any price text from description and title
  items = items.map((item, idx) => {
    const rawPrice = item.price;
    const numPrice = Number(rawPrice);
    const validPrice = Number.isFinite(numPrice) && numPrice > 0 ? numPrice : null;

    const rawTitle = String(item.title || 'Marketplace Item').trim();
    const cleanTitle = stripPriceFromText(rawTitle) || 'Marketplace Item';

    const rawDesc = String(item.description || cleanTitle).trim();
    const cleanDesc = stripPriceFromText(rawDesc) || cleanTitle;

    return {
      title: cleanTitle.slice(0, 100),
      description: cleanDesc.slice(0, 1500),
      price: validPrice,
      category: item.category || 'Other',
      condition: item.condition || 'unknown',
      brand: item.brand || null,
      specs: item.specs ? stripPriceFromText(item.specs) : null,
      location: item.location || parsed.location || null,
      image_index: Number.isInteger(item.image_index) ? item.image_index : idx,
    };
  }).filter(item => item.price !== null);

  return {
    is_commercial_listing: Boolean(parsed.is_commercial_listing && items.length > 0),
    seller_phone: parsed.seller_phone || null,
    location: parsed.location || null,
    items,
  };
}

export async function parseListingWithVision({ text = '', media = [] } = {}) {
  const message = String(text || '').trim();
  const imageItems = (media || []).filter(
    (m) => m?.kind === 'image' && Buffer.isBuffer(m?.buffer) && m.buffer.length > 0,
  );

  // If no text and no images, nothing to parse
  if (!message && imageItems.length === 0) {
    return { is_commercial_listing: false, items: [] };
  }

  // Multimodal prompt construction
  if (imageItems.length > 0) {
    const userContent = [
      {
        type: 'text',
        text: message
          ? `Seller's WhatsApp post:\n"""${message}"""\n\nPlease examine the attached product image(s). Identify all products being sold, extract individual prices, and generate professional titles and descriptions (without mentioning prices in descriptions).`
          : `A seller posted product image(s) without text description. Please examine the image(s), identify all items shown or flyer price text, extract prices, and generate appealing marketplace titles and descriptions (without mentioning prices in descriptions).`,
      },
    ];

    // Attach up to 4 images while keeping total payload safely under Groq limit
    let totalBytes = 0;
    for (const item of imageItems.slice(0, 4)) {
      if (item.buffer.length > 3_500_000) continue;
      if (totalBytes + item.buffer.length > 4_500_000) break;
      totalBytes += item.buffer.length;

      const mime = item.mimeType || 'image/jpeg';
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${mime};base64,${item.buffer.toString('base64')}`,
        },
      });
    }

    for (const model of VISION_MODELS) {
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: PROMPT_TEMPLATE },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1500,
        });
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        const normalized = normalizeParsedResult(parsed);
        if (normalized) {
          return normalized;
        }
      } catch (error) {
        console.warn(`[Vision parser] Model ${model} failed (${error?.message || error}), trying next...`);
      }
    }
  }

  // Fallback to text-only parsing if image vision failed or no images were provided
  if (message.length >= 3) {
    const textModelsToTry = [...new Set([...VISION_MODELS, ...FALLBACK_TEXT_MODELS])];
    for (const model of textModelsToTry) {
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: PROMPT_TEMPLATE },
            { role: 'user', content: `WhatsApp sale post:\n"""${message}"""` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1500,
        });
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        const normalized = normalizeParsedResult(parsed);
        if (normalized) {
          return normalized;
        }
      } catch (error) {
        console.warn(`[Text parser] Model ${model} failed (${error?.message || error}), trying fallback...`);
      }
    }
  }

  console.error('[Vision parser] All candidate models failed to parse listing.');
  return null;
}

export function looksLikeSalePost(text = '', hasMedia = false) {
  const source = String(text || '').toLowerCase().trim();
  if (hasMedia) {
    if (!source) return true; // Image with no text can be scanned for flyer/price stickers
    // When media is attached, any price shorthand, naira symbols, digits, or sale terms match
    if (/(?:\b\d+(?:[.,]\d+)?\s*[km]\b|₦|\bngn\b|\b\d{4,9}\b|\bprice\b|\bavailable\b|\bselling\b|\bfor sale\b|\bdm\b|\bcall\b|\bdeal\b|\bcondition\b)/i.test(source)) {
      return true;
    }
  }
  return /(?:\bfor sale\b|\bavailable\b|\bselling\b|\bprice\b|\b\d+(?:[.,]\d+)?\s*[km]\b|₦|\bngn\b|\bnego\b|\bforeign used\b|\btokunbo\b|\bdm\b|\bcall\b)/i.test(source);
}
