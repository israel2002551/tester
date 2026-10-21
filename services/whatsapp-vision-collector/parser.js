import Groq, { toFile } from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'not_configured',
  defaultHeaders: {
    'Accept-Encoding': 'gzip, deflate, br',
  },
});

const PRICE_WORDS = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
  ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15],
  ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60],
  ['seventy', 70], ['eighty', 80], ['ninety', 90],
]);

const PRICE_CONTEXT = '(?:price|cost|amount|rate|asking(?:\\s+price)?|last\\s+price|selling(?:\\s+for)?|going\\s+for|for|at|only|each|per|fixed|firm|nego(?:tiable)?)';
const NUMERIC_PRICE = '(?:\\d{1,3}(?:[ ,]\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
const SCALE = '(?:k|m|thousand|million)';
const MAX_VISION_IMAGES_PER_REQUEST = 3;
const MAX_INLINE_IMAGE_BYTES = 1_500_000;

function normalisePriceText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function parseNumberWords(value) {
  const tokens = normalisePriceText(value).toLowerCase()
    .replace(/\b(?:naira|ngn|only|and)\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (!tokens.some(token => PRICE_WORDS.has(token) || token === 'hundred' || token === 'thousand' || token === 'million')) return null;

  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (PRICE_WORDS.has(token)) {
      current += PRICE_WORDS.get(token);
    } else if (token === 'hundred') {
      current = Math.max(1, current) * 100;
    } else if (token === 'thousand' || token === 'million') {
      current = Math.max(1, current) * (token === 'thousand' ? 1_000 : 1_000_000);
      total += current;
      current = 0;
    } else {
      return null;
    }
  }
  const amount = total + current;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Converts common Nigerian price formats to a whole-naira amount. */
export function parseNairaAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  let source = normalisePriceText(value);
  if (!source) return null;

  const wordAmount = parseNumberWords(source);
  if (wordAmount !== null && /[a-z]/i.test(source) && !/\d/.test(source)) return wordAmount;

  source = source
    .toLowerCase()
    .replace(/(?:₦|\bngn\b|\bnaira\b|\bn(?=\s*\d)|#(?=\s*\d))/gi, '')
    .trim();
  const match = source.match(new RegExp(`(${NUMERIC_PRICE})\\s*(${SCALE})?`, 'i'));
  if (!match) return null;
  let numericText = match[1].replace(/\s/g, '');
  const scale = String(match[2] || '').toLowerCase();

  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numericText)) {
    numericText = numericText.replace(/,/g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(numericText)) {
    numericText = numericText.replace(/\./g, '').replace(',', '.');
  } else if (numericText.includes(',') && !numericText.includes('.')) {
    numericText = numericText.replace(',', '.');
  }

  const numeric = Number(numericText);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const multiplier = /^(?:k|thousand)$/i.test(scale) ? 1_000 : /^(?:m|million)$/i.test(scale) ? 1_000_000 : 1;
  const amount = Math.round(numeric * multiplier);
  return amount > 0 && amount <= 99_995_000 ? amount : null;
}

function isLikelyPhoneOrYear(raw, amount) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return true;
  return digits.length === 4 && amount >= 1900 && amount <= 2100;
}

/** Extracts Nigerian price candidates without treating dates and phone numbers as prices. */
export function extractNairaPriceCandidates(text, { mediaContext = false } = {}) {
  const source = normalisePriceText(text);
  if (!source) return [];
  const candidates = [];
  const addMatches = (pattern, confidence) => {
    for (const match of source.matchAll(pattern)) {
      const raw = match[0];
      const amount = parseNairaAmount(raw);
      if (amount === null || isLikelyPhoneOrYear(raw, amount)) continue;
      candidates.push({ raw, amount, index: match.index ?? 0, confidence });
    }
  };

  addMatches(new RegExp(`(?:₦|\\bngn\\b|\\bnaira\\b|\\bN(?=\\s*\\d)|#(?=\\s*\\d))\\s*${NUMERIC_PRICE}(?:\\s*${SCALE})?`, 'gi'), 'explicit');
  addMatches(new RegExp(`\\b${NUMERIC_PRICE}\\s*${SCALE}\\b`, 'gi'), 'scaled');
  addMatches(new RegExp(`\\b${PRICE_CONTEXT}\\b\\s*[:=#-]?\\s*${NUMERIC_PRICE}(?:\\s*${SCALE})?`, 'gi'), 'contextual');
  addMatches(new RegExp(`\\b${NUMERIC_PRICE}(?:\\s*${SCALE})?\\s*(?:each|per|only|fixed|firm|nego(?:tiable)?)\\b`, 'gi'), 'contextual');
  addMatches(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, 'grouped');

  if (mediaContext) {
    addMatches(/\b\d{1,3}\s\d{3}\b/g, 'spaced');
    addMatches(/\b\d{4,8}\b/g, 'media-bare');
  } else {
    // In text context, detect 5-8 digit whole naira amounts (e.g. 50000, 180000, 450000)
    addMatches(/\b\d{5,8}\b/g, 'text-bare');
  }

  const wordContext = new RegExp(`(?:\\b${PRICE_CONTEXT}\\b|\\bnaira\\b|\\bngn\\b)\\s*[:=#-]?\\s*([a-z][a-z\\s-]{2,80})`, 'gi');
  for (const match of source.matchAll(wordContext)) {
    const raw = match[0];
    const amount = parseNumberWords(match[1]);
    if (amount !== null && amount <= 99_995_000) {
      candidates.push({ raw, amount, index: match.index ?? 0, confidence: 'words' });
    }
  }
  const wordCurrency = /\b([a-z][a-z\s-]{2,80}?)\s+(?:naira|ngn)\b/gi;
  for (const match of source.matchAll(wordCurrency)) {
    const amount = parseNumberWords(match[1]);
    if (amount !== null && amount <= 99_995_000) {
      candidates.push({ raw: match[0], amount, index: match.index ?? 0, confidence: 'words' });
    }
  }

  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.index}:${candidate.raw.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((a, b) => a.index - b.index);
}

export function stripPriceFromText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(new RegExp(`\\b${PRICE_CONTEXT}\\b\\s*[:=#-]?\\s*(?:₦|NGN|Naira|N|#)?\\s*${NUMERIC_PRICE}(?:\\s*${SCALE})?`, 'gi'), '')
    .replace(new RegExp(`(?:₦|\\bngn\\b|\\bnaira\\b|\\bN(?=\\s*\\d)|#(?=\\s*\\d))\\s*${NUMERIC_PRICE}(?:\\s*${SCALE})?`, 'gi'), '')
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, '')
    .replace(/(^|\s)\d+(?:[.,]\d+)?\s*[kKmM]\b/gi, '$1')
    .replace(/(?:\bfor\b|\bat\b|\b#)\s*[\d,]{4,10}\b/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([.,;:!?-])\s*([.,;:!?-])+/g, '$1')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/^\s*[,:;-]\s*/gm, '')
    .replace(/\s*[,:;-]\s*$/gm, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

export function hasPriceInText(text, { mediaContext = false } = {}) {
  return extractNairaPriceCandidates(text, { mediaContext }).length > 0;
}

const PROMPT_TEMPLATE = `
You extract marketplace listing fields from WhatsApp sale posts, product images, and video frames for BUYSELL Nigeria.

A WhatsApp post may contain one product or a list of several products. A post can have no written description; in that case, use the visual input and any visible flyer text. An audio transcript, when supplied, is only an aid and may contain recognition errors.

CRITICAL STRICT RULES:
1. DESCRIPTION AND TITLE MUST NEVER CONTAIN THE PRICE, CURRENCY, OR PAYMENT TERMS. Prices belong exclusively in the price field. Describe brand, model, colour, physical condition, specifications, materials, and included accessories instead.
2. MULTI-PRODUCT PARSING:
   - Return one item for each distinct product that is actually offered for sale.
   - Do not merge different products, and do not emit duplicate items for different photos/frames of the same product.
3. PRICE EXTRACTION:
   - Extract the exact numeric price for each item from text, audio transcript, flyer image, or video frame.
   - Expand Nigerian formats: "350k" -> 350000, "1.5m" -> 1500000, "₦60,000" -> 60000, "N5500" -> 5500, "5 500" -> 5500, and written amounts such as "five thousand five hundred naira" -> 5500.
   - Return both price_raw (the wording seen) and price (the normalized whole-naira integer).
   - Never invent a price. Set price and price_raw to null when no fixed price is stated.

Return exactly one JSON object with these keys:
- is_commercial_listing: boolean (true if one or more commercial items/services are offered for sale; false for chat, memes, complaints, or requests to buy)
- seller_phone: Nigerian seller phone digits only or null
- location: city, area, campus, or town or null
- items: array of product objects, where each object has:
  * title: concise, attractive product title (maximum 80 characters, no price)
  * description: clear, appealing product description (1-3 sentences, no price or currency figures)
  * price: whole Nigerian naira amount as a number, or null
  * price_raw: exact written price or null
  * category: one of "Phones & Tablets", "Computers & Laptops", "Electronics", "Vehicles", "Fashion", "Home & Furniture", "Beauty & Health", "Services", "Other"
  * condition: one of "brand_new", "foreign_used", "local_used", "refurbished", "unknown"
  * brand: manufacturer/brand or null
  * specs: short factual specification summary or null
  * image_index: 0-based index of the matching visual input, or 0 if all visuals belong to it

Output only JSON.
`;

const VISION_MODELS = [...new Set([
  process.env.GROQ_MODEL,
  'qwen/qwen3.8-27b',
].filter(Boolean))];

const FALLBACK_TEXT_MODELS = [...new Set([
  process.env.GROQ_TEXT_MODEL,
  process.env.GROQ_MODEL,
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
].filter(Boolean))];

function normalizeParsedResult(parsed, { mediaIndexMap = [] } = {}) {
  if (!parsed || typeof parsed !== 'object') return null;

  let items = Array.isArray(parsed.items) && parsed.items.length > 0
    ? parsed.items
    : (parsed.title || parsed.price || parsed.price_raw ? [parsed] : []);

  items = items.map((item, idx) => {
    const row = item && typeof item === 'object' ? item : {};
    const rawPrice = row.price ?? row.price_raw;
    const validPrice = parseNairaAmount(rawPrice);
    const rawTitle = String(row.title || 'Marketplace Item').trim();
    const cleanTitle = stripPriceFromText(rawTitle) || 'Marketplace Item';
    const rawDesc = String(row.description || cleanTitle).trim();
    const cleanDesc = stripPriceFromText(rawDesc) || cleanTitle;
    const inputIndex = Number.isInteger(row.image_index) && row.image_index >= 0 ? row.image_index : idx;

    return {
      title: cleanTitle.slice(0, 100),
      description: cleanDesc.slice(0, 1500),
      price: validPrice,
      price_raw: row.price_raw || (validPrice ? String(rawPrice) : null),
      category: row.category || 'Other',
      condition: row.condition || 'unknown',
      brand: row.brand || null,
      specs: row.specs ? stripPriceFromText(row.specs) : null,
      location: row.location || parsed.location || null,
      image_index: mediaIndexMap[inputIndex] ?? mediaIndexMap[idx] ?? inputIndex,
    };
  }).filter(item => item.title && item.description);

  return {
    is_commercial_listing: Boolean(parsed.is_commercial_listing && items.length > 0),
    seller_phone: parsed.seller_phone || null,
    location: parsed.location || null,
    items,
  };
}

function visualUrlFromBuffer(item) {
  const buffer = Buffer.isBuffer(item?.buffer) ? item.buffer : Buffer.isBuffer(item?.previewBuffer) ? item.previewBuffer : null;
  if (!buffer || !buffer.length || buffer.length > MAX_INLINE_IMAGE_BYTES) return '';
  const mimeType = item?.kind === 'video' || item?.type === 'video' ? 'image/jpeg' : (item?.mimeType || 'image/jpeg');
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function visualInputs(media) {
  const inputs = [];
  for (let mediaIndex = 0; mediaIndex < (media || []).length; mediaIndex += 1) {
    const item = media[mediaIndex] || {};
    const kind = item.kind || item.type;
    if (kind === 'image') {
      const url = item.vision_url || item.url || visualUrlFromBuffer(item);
      if (url) inputs.push({ url, mediaIndex });
      continue;
    }
    if (kind === 'video') {
      const urls = Array.isArray(item.vision_urls) ? item.vision_urls : Array.isArray(item.preview_urls) ? item.preview_urls : [];
      const fallBackUrl = visualUrlFromBuffer(item);
      for (const url of [...urls, fallBackUrl].filter(Boolean)) {
        inputs.push({ url, mediaIndex });
      }
    }
  }
  return inputs;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function mergeParsedResults(results) {
  const valid = results.filter(Boolean);
  if (!valid.length) return null;
  const itemsByTitle = new Map();
  for (const result of valid) {
    for (const item of result.items || []) {
      const key = String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const existing = itemsByTitle.get(key);
      if (!existing || (!existing.price && item.price)) itemsByTitle.set(key, item);
    }
  }
  const first = valid[0];
  return {
    is_commercial_listing: valid.some(result => result.is_commercial_listing) && itemsByTitle.size > 0,
    seller_phone: valid.map(result => result.seller_phone).find(Boolean) || null,
    location: valid.map(result => result.location).find(Boolean) || null,
    items: [...itemsByTitle.values()],
  };
}

async function parseVisionChunk(message, visualChunk) {
  const mediaIndexMap = visualChunk.map(input => input.mediaIndex);
  const visualContext = visualChunk.map((input, index) => `visual input ${index} is source media ${input.mediaIndex}`).join(', ');
  const text = message
    ? `Seller's WhatsApp post:\n"""${message}"""\n\n${visualContext}. Examine every visual input. Identify all products being sold, extract individual prices, and generate professional titles and descriptions without prices.`
    : `A seller posted product visual(s) without a written description. ${visualContext}. Examine every visual input for the product, flyer text, and visible price. Generate professional titles and descriptions without prices.`;
  const userContent = [
    { type: 'text', text },
    ...visualChunk.map(input => ({ type: 'image_url', image_url: { url: input.url } })),
  ];

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
        max_tokens: 1_500,
      });
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      const normalized = normalizeParsedResult(parsed, { mediaIndexMap });
      if (normalized) return normalized;
    } catch (error) {
      console.warn(`[Vision parser] Model ${model} failed (${error?.message || error}), trying next...`);
    }
  }
  return null;
}

async function parseTextOnly(message) {
  const textModelsToTry = [...new Set([...FALLBACK_TEXT_MODELS, ...VISION_MODELS])];
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
        max_tokens: 1_500,
      });
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      const normalized = normalizeParsedResult(parsed);
      if (normalized) return normalized;
    } catch (error) {
      console.warn(`[Text parser] Model ${model} failed (${error?.message || error}), trying fallback...`);
    }
  }
  return null;
}

/** Transcribes video audio before its binary leaves the collector process. */
export async function transcribeVideoAudio({ buffer, mimeType = '' } = {}) {
  if (String(process.env.WHATSAPP_TRANSCRIBE_VIDEO_AUDIO || 'true').toLowerCase() === 'false') return '';
  const maxBytes = Math.max(500_000, Number(process.env.MAX_AUDIO_TRANSCRIBE_BYTES || 2_097_152));
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) return '';
  try {
    const file = await toFile(buffer, 'whatsapp-video.mp4', { type: mimeType || 'video/mp4' });
    const result = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      language: 'en',
      prompt: 'Transcribe product names, Nigerian naira prices, sizes, colours, condition, and location accurately.',
      temperature: 0,
    });
    return String(result?.text || '').trim().slice(0, 12_000);
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (/no[_\s]audio[_\s]stream|no audio track/i.test(errorMsg)) {
      // Normal for silent or muted product videos; proceed with visual analysis
      return '';
    }
    console.warn(`[Video transcription] ${errorMsg}`);
    return '';
  }
}

export async function parseListingWithVision({ text = '', media = [], audioTranscript = '' } = {}) {
  const cleanText = String(text || '').trim();
  const transcript = String(audioTranscript || '').trim();
  const message = [cleanText, transcript ? `Video audio transcript (may contain recognition errors):\n${transcript}` : '']
    .filter(Boolean)
    .join('\n\n');
  const inputs = visualInputs(media);
  if (!message && inputs.length === 0) return { is_commercial_listing: false, items: [] };

  // 1. FAST TEXT PARSING: When the seller has provided a written description,
  // parse the product details directly using fast text models (Llama-3.3-70B / 3.1-8B).
  // Do NOT send images to Vision AI when the product already has a clear description.
  const hasDescription = cleanText.length >= 8 && /[a-zA-Z]{2,}/.test(cleanText);
  if (hasDescription) {
    const textParsed = await parseTextOnly(message);
    if (textParsed?.is_commercial_listing && textParsed.items?.length > 0) {
      const hasPrices = textParsed.items.some(item => Number(item?.price) > 0);
      if (hasPrices || inputs.length === 0) {
        console.info(`[Listing Parser] Parsed ${textParsed.items.length} product(s) directly from written description without Vision AI.`);
        return textParsed;
      }
      console.info('[Listing Parser] Written description lacked price. Checking visual inputs for visible price/flyer...');
    }
  }

  // 2. VISION AI: Only used when the post DOES NOT have a description,
  // or when the description lacked a price and flyer OCR is needed.
  if (inputs.length > 0) {
    console.info(`[Vision AI] Post has no written description (or lacked price). Inspecting ${inputs.length} visual input(s)...`);
    const parsedChunks = [];
    for (const visualChunk of chunk(inputs, MAX_VISION_IMAGES_PER_REQUEST)) {
      const parsed = await parseVisionChunk(message, visualChunk);
      if (parsed) parsedChunks.push(parsed);
    }
    const merged = mergeParsedResults(parsedChunks);
    if (merged?.items.length) return merged;
  }

  // 3. Fallback to text parsing if visual models failed or weren't used
  if (message.length >= 3) {
    const parsed = await parseTextOnly(message);
    if (parsed) return parsed;
  }

  console.error('[Vision parser] All candidate models failed to parse listing.');
  return null;
}

export function looksLikeSalePost(text = '', hasMedia = false) {
  // In WhatsApp Buy/Sell groups, ANY photo or video is presumed to be a product!
  // Never discard a media post as non-sale.
  if (hasMedia) return true;

  const source = String(text || '').trim();
  if (!source) return false;

  // Filter out pure conversational greetings or administrative messages
  const nonSaleChat = /^(?:good morning|good afternoon|good evening|happy sunday|happy new month|amen|congrats|congratulations|hello admin|admin please|scam alert|fake alert|please remove|thanks|thank you|ok|okay|noted|lol|lmao|yes|no)[.!]?$/i;
  if (nonSaleChat.test(source)) return false;

  // Check for any price figures
  if (hasPriceInText(source, { mediaContext: false })) return true;

  // Expanded commercial sale terms
  const saleTerms = /(?:\bfor sale\b|\bavailable\b|\bselling\b|\bprice\b|\bnego\b|\bforeign used\b|\btokunbo\b|\bdm\b|\bcall\b|\bdeal\b|\bcondition\b|\bswap\b|\bpay on delivery\b|\bpod\b|\bwaybill\b|\bpickup\b|\bgiveaway\b|\bpromo\b|\bdiscount\b|\borders?\b|\bstock\b|\bwholesale\b|\bretail\b|\bclean\b|\bgrade a\b|\bbrand new\b|\buk used\b|\bdirect belgium\b|\btested ok\b|\bworking perfect\b|\bbattery health\b|\bbh\b)/i;
  if (saleTerms.test(source)) return true;

  // Product categories commonly posted in Nigerian marketplace groups
  const productTerms = /(?:\biphone\b|\bsamsung\b|\bpixel\b|\bredmi\b|\btecno\b|\binfinix\b|\bmacbook\b|\blaptop\b|\bhp\b|\bdell\b|\blenovo\b|\basus\b|\bacer\b|\bplaystation\b|\bps[45]\b|\bxbox\b|\btv\b|\bsneakers?\b|\bshoes?\b|\bcrocs\b|\bwatch(?:es)?\b|\brolex\b|\bbags?\b|\bperfumes?\b|\bwigs?\b|\bhair\b|\bdress(?:es)?\b|\bshirts?\b|\bcars?\b|\btoyota\b|\blexus\b|\bbenz\b|\bhonda\b|\bgenerator\b|\binverter\b|\bsolar\b|\bpower bank\b|\bairpods\b|\bchargers?\b)/i;
  if (productTerms.test(source)) return true;

  // Hardware/apparel specifications like "128gb", "256gb", "16gb ram", "size 42", etc.
  const specTerms = /(?:\b\d+\s*(?:gb|tb|mb|ram|rom|mah)\b|\bsize\s*\d+\b|\b\d+\s*(?:inches|inch)\b)/i;
  if (specTerms.test(source)) return true;

  return false;
}

export function normalizeWhatsAppPhoneNumber(raw) {
  let cleaned = String(raw || '').replace(/\D/g, '');
  if (!cleaned) return '';
  // Convert Nigerian domestic format (e.g. 09061484256) to international (2349061484256)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = `234${cleaned.slice(1)}`;
  } else if (cleaned.length === 10 && !cleaned.startsWith('234')) {
    cleaned = `234${cleaned}`;
  }
  return cleaned;
}
