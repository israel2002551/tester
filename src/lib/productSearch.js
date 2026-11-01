// Product search shared by the marketplace (app.js reads it as window.BuysellSearch)
// and the category pages. Matching is by whole words, so "ring" finds rings rather
// than every "dining" or "earring", and results come back best match first.

const FIELD_WEIGHTS = { name: 10, category: 5, store: 4, location: 2, description: 1.5 };
// Numbers and model codes only count in these fields: "iphone 12" must not match
// "12 months warranty", nor "a16" a laptop described as "a 16-inch display".
const NUMBER_FIELDS = new Set(['name', 'category', 'store']);
// A word found in several fields (name and description) ranks a little higher.
const OTHER_FIELD_SHARE = 0.3;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'at', 'by', 'from', 'is', 'are',
  'i', 'me', 'my', 'need', 'want', 'looking', 'buy', 'sell', 'sale', 'available', 'please', 'any', 'some',
]);

// Other words shoppers use for the same thing, keyed and listed by stem. These
// matches rank below direct ones, so "gown" shows gowns first, then dresses.
const SYNONYMS = {
  phone: ['smartphone', 'iphone', 'mobile'],
  mobile: ['phone', 'smartphone'],
  smartphone: ['phone', 'iphone'],
  laptop: ['macbook', 'chromebook', 'thinkpad'],
  computer: ['laptop', 'desktop', 'pc', 'macbook'],
  tv: ['television'],
  television: ['tv'],
  shoe: ['sneaker', 'heel', 'sandal', 'slipper', 'slide', 'loafer', 'boot', 'footwear', 'mule'],
  footwear: ['shoe', 'sneaker', 'sandal', 'slipper', 'slide'],
  sneaker: ['trainer'],
  trainer: ['sneaker'],
  bag: ['handbag', 'backpack', 'purse', 'tote'],
  handbag: ['bag', 'purse'],
  purse: ['handbag', 'wallet'],
  gown: ['dress'],
  dress: ['gown'],
  trouser: ['pant'],
  pant: ['trouser'],
  perfume: ['fragrance', 'cologne'],
  fragrance: ['perfume', 'cologne'],
  cologne: ['perfume', 'fragrance'],
  airpod: ['earbud', 'earpod'],
  earbud: ['airpod', 'earpod', 'earphone'],
  earphone: ['earbud', 'headphone'],
  headphone: ['headset', 'earphone'],
  headset: ['headphone'],
  fridge: ['refrigerator', 'freezer'],
  refrigerator: ['fridge'],
  watch: ['smartwatch', 'wristwatch'],
  smartwatch: ['watch'],
  necklace: ['pendant'],
  chain: ['necklace'],
  sofa: ['couch'],
  couch: ['sofa'],
  hoodie: ['sweatshirt'],
  sweatshirt: ['hoodie'],
  tee: ['tshirt'],
  tshirt: ['tee'],
  jewelry: ['jewellery', 'necklace', 'bracelet', 'earring', 'ring'],
  jewellery: ['jewelry', 'necklace', 'bracelet', 'earring', 'ring'],
  dropship: ['dropshipping', '1688', 'sourcing'],
  sourcing: ['dropship', '1688'],
};

// Describing words, by stem. When nothing matches every word, these are dropped
// first: "women's bag" then shows bags rather than nothing.
const MODIFIERS = new Set([
  'red', 'blue', 'black', 'white', 'green', 'pink', 'gold', 'golden', 'silver', 'brown', 'grey', 'gray',
  'purple', 'yellow', 'orange', 'wine', 'maroon', 'beige', 'navy',
  'men', 'man', 'women', 'woman', 'lady', 'male', 'female', 'kid', 'child', 'children', 'boy', 'girl', 'unisex',
  'new', 'used', 'original', 'quality', 'cheap', 'affordable', 'luxury', 'big', 'small', 'mini', 'large', 'latest',
]);

const QUALITY = { exact: 1, stem: 0.9, synonym: 0.75, correction: 0.7, prefix: 0.6, correctionSynonym: 0.5 };

const isNumber = token => /^\d+$/.test(token);
const isWord = token => /^[a-z]+$/.test(token);

function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/(\d)\s*(?:"|”|″)/g, '$1 inch ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Light English stemming, enough for shoes/shoe, dresses/dress, batteries/battery.
function stem(token) {
  if (!isWord(token) || token.length < 4) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (/(ch|sh|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

function indexField(text) {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  const words = new Set(tokens);
  // "air fryer" and "airfryer" should find each other.
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (isWord(tokens[index]) && isWord(tokens[index + 1])) words.add(tokens[index] + tokens[index + 1]);
  }
  return { tokens, words, stems: new Set(tokens.map(stem)), text: tokens.join(' ') };
}

const productIndexes = new WeakMap();

function indexProduct(product) {
  let index = productIndexes.get(product);
  if (index) return index;
  const profile = product.profiles || {};
  index = {
    name: indexField(product.name || product.title),
    category: indexField(product.category),
    store: indexField([profile.store_name, profile.name, product.store_name].filter(Boolean).join(' ')),
    location: indexField(product.location),
    description: indexField(product.description),
  };
  productIndexes.set(product, index);
  return index;
}

const vocabularies = new WeakMap();

function vocabularyFor(rows) {
  let vocabulary = vocabularies.get(rows);
  if (vocabulary) return vocabulary;
  const counts = new Map();
  const stems = new Set();
  rows.forEach(product => {
    const index = indexProduct(product);
    Object.keys(FIELD_WEIGHTS).forEach(field => {
      index[field].words.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
      index[field].stems.forEach(value => stems.add(value));
    });
  });
  vocabulary = { counts, stems, words: [...counts.keys()].filter(word => isWord(word) && word.length > 2) };
  vocabularies.set(rows, vocabulary);
  return vocabulary;
}

// Optimal string alignment distance, giving up once it exceeds `limit`.
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previousRow = null;
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const nextRow = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(row[j] + 1, nextRow[j - 1] + 1, row[j - 1] + cost);
      if (previousRow && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previousRow[j - 2] + 1);
      }
      nextRow[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
    previousRow = row;
    row = nextRow;
  }
  return row[b.length];
}

function corrections(term, vocabulary) {
  const limit = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
  if (!limit) return [];
  let best = limit + 1;
  let found = [];
  vocabulary.words.forEach(word => {
    if (word[0] !== term[0]) return;
    const distance = editDistance(term, word, limit);
    if (distance < best) {
      best = distance;
      found = [word];
    } else if (distance === best) found.push(word);
  });
  return best > limit ? [] : found.sort((a, b) => vocabulary.counts.get(b) - vocabulary.counts.get(a)).slice(0, 3);
}

// "phones under 50k", "bags below 10,000", "shoes above 20000".
const PRICE_PATTERNS = [
  ['max', /\b(?:under|below|less than|cheaper than|max(?:imum)?|within)\s*(?:n|ngn|₦)?\s*(\d[\d,.]*)\s*(k|m)?\b/],
  ['min', /\b(?:over|above|more than|from|min(?:imum)?|at least)\s*(?:n|ngn|₦)?\s*(\d[\d,.]*)\s*(k|m)?\b/],
];

function readPrices(query) {
  let rest = query;
  const prices = {};
  PRICE_PATTERNS.forEach(([key, pattern]) => {
    const match = rest.match(pattern);
    if (!match) return;
    const amount = Number(match[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[match[2]] || 1);
    if (!Number.isFinite(amount) || amount <= 0) return;
    prices[key] = amount;
    rest = rest.replace(match[0], ' ');
  });
  return { rest, prices };
}

function parseQuery(query, vocabulary) {
  const { rest, prices } = readPrices(String(query || '').toLowerCase());
  let groups = rest.split(/\s+/)
    .map(word => normalizeText(word).split(' ').filter(Boolean))
    .filter(parts => parts.length)
    .map(parts => ({ parts }));
  const meaningful = groups.filter(group => group.parts.length > 1 || !STOP_WORDS.has(group.parts[0]));
  if (meaningful.length) groups = meaningful;
  const fixes = [];
  groups.forEach(group => {
    const [term] = group.parts;
    group.synonyms = new Set(SYNONYMS[stem(term)] || []);
    group.corrections = [];
    group.correctionSynonyms = new Set();
    group.modifier = group.parts.length === 1 && MODIFIERS.has(stem(term));
    group.prefix = false;
    if (group.parts.length > 1 || !isWord(term)) return;
    const known = vocabulary.counts.has(term) || vocabulary.stems.has(stem(term));
    if (known) return;
    // Not a word in the catalogue: the shopper is still typing, or made a typo.
    group.prefix = term.length >= 2 && vocabulary.words.some(word => word.startsWith(term));
    if (group.prefix) return;
    group.corrections = corrections(term, vocabulary);
    group.corrections.forEach(word => (SYNONYMS[stem(word)] || []).forEach(value => group.correctionSynonyms.add(value)));
    if (group.corrections.length) fixes.push({ from: term, to: group.corrections[0] });
  });
  // Neighbouring words may be one word in a listing ("air fryer" for "Airfryer").
  groups.forEach((group, index) => {
    const next = groups[index + 1];
    if (next && group.parts.length === 1 && next.parts.length === 1 && isWord(group.parts[0]) && isWord(next.parts[0])) {
      group.joined = group.parts[0] + next.parts[0];
    }
  });
  return { groups, prices, fixes, phrase: groups.map(group => group.parts.join(' ')).join(' ') };
}

function wordQuality(group, field) {
  const [term] = group.parts;
  if (field.words.has(term)) return QUALITY.exact;
  if (isNumber(term)) return 0;
  if (field.stems.has(stem(term))) return QUALITY.stem;
  for (const value of group.synonyms) if (field.stems.has(value) || field.words.has(value)) return QUALITY.synonym;
  for (const value of group.corrections) if (field.words.has(value) || field.stems.has(stem(value))) return QUALITY.correction;
  if (group.prefix && field.tokens.some(token => token.startsWith(term))) return QUALITY.prefix;
  for (const value of group.correctionSynonyms) if (field.stems.has(value) || field.words.has(value)) return QUALITY.correctionSynonym;
  return 0;
}

// "a16", "256gb", "t-shirt": the parts must sit next to each other.
function partsQuality(parts, field) {
  if (parts.every(isWord) && field.words.has(parts.join(''))) return QUALITY.exact;
  const last = parts.length - 1;
  for (let start = 0; start + parts.length <= field.tokens.length; start += 1) {
    const fits = parts.every((part, offset) => {
      const token = field.tokens[start + offset];
      return offset === last && isWord(part) ? token.startsWith(part) : token === part;
    });
    if (fits) return QUALITY.exact;
  }
  return 0;
}

function scoreProduct(product, query, allowMissing, skipModifiers) {
  const index = indexProduct(product);
  const { groups } = query;
  const inName = groups.map(() => false);
  const scores = groups.map((group, position) => {
    const fieldScores = [];
    Object.entries(FIELD_WEIGHTS).forEach(([field, weight]) => {
      if (group.parts.some(isNumber) && !NUMBER_FIELDS.has(field)) return;
      const quality = group.parts.length > 1 ? partsQuality(group.parts, index[field]) : wordQuality(group, index[field]);
      if (!quality) return;
      fieldScores.push(weight * quality);
      if (field === 'name') inName[position] = true;
    });
    if (!fieldScores.length) return 0;
    const best = Math.max(...fieldScores);
    return best + OTHER_FIELD_SHARE * (fieldScores.reduce((sum, value) => sum + value, 0) - best);
  });
  groups.forEach((group, position) => {
    if (!group.joined || (scores[position] && scores[position + 1])) return;
    Object.entries(FIELD_WEIGHTS).forEach(([field, weight]) => {
      if (!index[field].words.has(group.joined)) return;
      scores[position] = Math.max(scores[position], weight);
      scores[position + 1] = Math.max(scores[position + 1], weight);
      if (field === 'name') inName[position] = inName[position + 1] = true;
    });
  });
  const missing = scores.filter((score, position) => !score && !(skipModifiers && groups[position].modifier)).length;
  if (missing > allowMissing) return 0;
  let score = scores.reduce((sum, value) => sum + value, 0);
  const name = index.name.text;
  if (inName.every(Boolean)) score += 6;
  if (groups.length > 1 && ` ${name} `.includes(` ${query.phrase} `)) score += 4;
  if (name === query.phrase) score += 3;
  else if (index.name.tokens[0] === groups[0].parts[0]) score += 1;
  return scores.some(value => !value) ? score * 0.7 : score;
}

export function normalizeSearchQuery(query = '') {
  return String(query || '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

// Returns { items, fixes, partial }: items best match first; fixes lists typo
// corrections used ({ from, to }); partial means no listing matched every word,
// so these are the closest matches.
export function searchProducts(rows = [], rawQuery = '') {
  const list = Array.isArray(rows) ? rows : [];
  const text = normalizeSearchQuery(rawQuery);
  if (!text) return { items: [...list], fixes: [], partial: false };
  const query = parseQuery(text, vocabularyFor(list));
  const { max, min } = query.prices;
  const priced = list.filter(product => {
    const price = Number(product.price) || 0;
    return (!max || price <= max) && (!min || price >= min);
  });
  if (!query.groups.length) return { items: priced, fixes: [], partial: false };
  const rank = (allowMissing, skipModifiers) => priced
    .map((product, order) => ({ product, order, score: scoreProduct(product, query, allowMissing, skipModifiers) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(entry => entry.product);
  let items = rank(0, false);
  const exact = items.length > 0;
  // Otherwise show the closest matches: first without describing words
  // ("women's bag" shows bags), then, for long searches such as
  // "iphone 16 pro max 1tb blue", missing one word in three.
  const hasModifier = query.groups.some(group => group.modifier);
  if (!items.length && hasModifier && query.groups.some(group => !group.modifier)) items = rank(0, true);
  const allowMissing = Math.floor(query.groups.length / 3);
  if (!items.length && allowMissing) items = rank(allowMissing, false);
  return { items, fixes: query.fixes, partial: !exact && items.length > 0 };
}

// Builds the search index while the browser is idle, so the first search is instant.
export function prepareSearch(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return;
  const build = () => vocabularyFor(rows);
  if (typeof window !== 'undefined' && window.requestIdleCallback) window.requestIdleCallback(build, { timeout: 2000 });
  else setTimeout(build, 200);
}

// Up to `limit` short searches to try when a search finds little.
export function searchSuggestions(rows = [], rawQuery = '', limit = 3) {
  const list = Array.isArray(rows) ? rows : [];
  const text = normalizeText(normalizeSearchQuery(rawQuery));
  if (!text || !list.length) return [];
  const query = parseQuery(text, vocabularyFor(list));
  const corrected = query.fixes.length
    ? [query.groups.map(group => group.corrections[0] || group.parts.join(' ')).join(' ')]
    : [];
  const parts = query.groups.flatMap(group => [...group.parts, ...group.synonyms, ...group.corrections, ...group.correctionSynonyms])
    .filter(part => isWord(part) && part.length > 2);
  const options = [...new Set([
    ...list.map(product => String(product.category || '').trim()),
    ...list.map(product => String(product.name || product.title || '').trim()),
  ].filter(Boolean))];
  const related = options.filter(option => {
    const tokens = normalizeText(option).split(' ');
    return normalizeText(option) !== text && parts.some(part => tokens.some(token => token.startsWith(part) || stem(token) === part));
  });
  return [...new Set([...corrected, ...related])].slice(0, limit);
}
