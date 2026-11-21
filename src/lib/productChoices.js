// What a buyer must choose before a product goes in the cart, shared by the
// product page, the cart drawer and app.js (window.BuysellChoices):
//
//   - a size, for clothes, shoes and rings (fashion and sports listings).
//     The sizes come from the listing when it states them ("37-42",
//     "S-XL", "5-14 yrs"), otherwise from the usual range for that kind of
//     item, and "Other" lets the buyer type one;
//   - which photo, when a listing has two or more photos: several photos
//     under one price usually show different colours or designs.
//
// The choices travel with the cart line to checkout, where the server
// (supabase/functions/_shared/orderChoices.ts) stores them on the order.

const SIZED_CATEGORIES = new Set(['fashion', 'sports']);
const FREE_SIZE = /\b(free[ -]?size|one[ -]?size|fits? all|all sizes fit)\b/;
const SHOE = /\b(shoes?|sneakers?|trainers?|heels?|stilettos?|sandals?|slippers?|slides?|loafers?|boots?|crocs|mules?|flats|footwear|pams?|palms?|slingbacks?|wedges?|brogues?|oxfords?|moccasins?|espadrilles?|kitten-heel)\b/;
const RING = /\brings?\b/;
const CLOTHING = /\b(dress(es)?|gowns?|tops?|t-?shirts?|tees?|shirts?|blouses?|trousers?|pants|jeans?|jorts|shorts|skirts?|skorts?|jumpsuits?|rompers?|playsuits?|hoodies?|sweatshirts?|sweaters?|cardigans?|jackets?|blazers?|coats?|suits?|pantsuits?|two[- ]?piece|co-?ords?|outfits?|cloth(ing|es)|wears?|abayas?|kaftans?|caftans?|agbadas?|senators?|bubu|boubou|jalabiy?a|kimonos?|pyjamas?|pajamas?|nightw(ear|are)|(beach|swim|sports?|active|gym|lounge|party)\s?wear|lingerie|bras?|bralettes?|panties|briefs|boxers?|underwears?|leggings|joggers?|tracksuits?|vests?|singlets?|polos?|jerseys?|corsets?|bodysuits?|swimsuits?|bikinis?|overalls?|dungarees?|uniforms?|waistcoats?)\b/;
const NO_SIZE = /\b(bags?|handbags?|purses?|wallets?|clutch(es)?|totes?|backpacks?|watch(es)?|wristwatch(es)?|smartwatch(es)?|necklaces?|chains?|pendants?|bracelets?|bangles?|earrings?|anklets?|brooch(es)?|sunglasses|glasses|caps?|hats?|beanies?|bonnets?|durags?|scarf|scarves|belts?|perfumes?|fragrances?|box|wigs?|keychains?|umbrellas?|luggages?|suitcases?|socks|stands?|racks?|organi[sz]ers?|polish|insoles?|laces?|cleaners?|hangers?|jewel(le)?ry|jewelries|zirconia)\b/;
const KINDS = [['shoe', SHOE], ['ring', RING], ['clothing', CLOTHING], [null, NO_SIZE]];
const KIDS = /\b(kids?|children|childrens|child|girls|boys|baby|babies|toddlers?|infants?|\d{1,2}\s*-\s*\d{1,2}\s*(yrs|years))\b/;

const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const LETTER_ALIASES = { '2XL': 'XXL', XXXL: '3XL', XXXXL: '4XL' };
const DEFAULTS = {
  shoe: Array.from({ length: 11 }, (_, index) => String(36 + index)),
  kidsShoe: Array.from({ length: 12 }, (_, index) => String(24 + index)),
  clothing: ['S', 'M', 'L', 'XL', 'XXL', '3XL'],
  kids: Array.from({ length: 14 }, (_, index) => `${index + 1} yrs`),
  ring: Array.from({ length: 8 }, (_, index) => String(5 + index)),
};

function text(value) {
  return String(value || '').toLowerCase().replace(/[‘’`]/g, "'");
}

// "37-42" → 37…42, the first such range within the bounds. "32/34" with a
// slash and a gap of two is the two sizes, as jeans are listed.
function numberRange(source, low, high, maxSpan) {
  for (const match of source.matchAll(/\b(\d{2})\s*(-|–|—|to|_+|~|\/)\s*(\d{2})\b/g)) {
    const start = Number(match[1]);
    const end = Number(match[3]);
    if (start < low || end > high || end <= start || end - start > maxSpan) continue;
    if (match[2] === '/' && end - start === 2) return [String(start), String(end)];
    return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
  }
  return null;
}

// "Size 38", "Sizes: 40, 41, 43" → the sizes named.
function listedNumbers(source, low, high) {
  const match = source.match(/\bsizes?\s*:?\s*(\d{2}(?:\s*(?:,|\/|&|and|\s)\s*\d{2})*)\b/);
  if (!match) return null;
  const sizes = [...new Set([...match[1].matchAll(/\d{2}/g)].map(found => Number(found[0])))]
    .filter(size => size >= low && size <= high)
    .sort((a, b) => a - b);
  return sizes.length ? sizes.map(String) : null;
}

// UK shoe sizes: "Sizes 7-12", "UK 6 to 10".
function ukShoeSizes(source) {
  const match = source.match(/\b(?:uk|sizes?)\s*:?\s*(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end > 15 || end <= start) return null;
  return Array.from({ length: end - start + 1 }, (_, index) => `UK ${start + index}`);
}

function letterSizes(source) {
  // "women's", "men's", "l'oreal": the letter after an apostrophe is not a size.
  const upper = source.toUpperCase().replace(/'[A-Z]+/g, '');
  const normal = token => LETTER_ALIASES[token] || token;
  const range = upper.match(/\b(XXS|XS|S|M|L|XL|XXL|2XL|XXXL|3XL|4XL|5XL)\s*(?:-|–|TO)\s*(XXS|XS|S|M|L|XL|XXL|2XL|XXXL|3XL|4XL|5XL)\b/);
  if (range) {
    const start = LETTERS.indexOf(normal(range[1]));
    const end = LETTERS.indexOf(normal(range[2]));
    if (start >= 0 && end > start) return LETTERS.slice(start, end + 1);
  }
  const listed = [...upper.matchAll(/\b(XXS|XS|XXL|2XL|XXXL|3XL|4XL|5XL|XL|S|M|L)\b/g)].map(found => normal(found[1]));
  const unique = LETTERS.filter(letter => listed.includes(letter));
  // A lone "S" or "M" in a sentence is not a size list.
  return unique.length >= 2 ? unique : null;
}

function kidsAges(source) {
  const range = source.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:yrs?|years?)\b/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end > start && end <= 16) return Array.from({ length: end - start + 1 }, (_, index) => `${start + index} yrs`);
  }
  const listed = [...source.matchAll(/\b(\d{1,2})\s*(?:yrs?|years?)\b/g)].map(found => Number(found[1])).filter(age => age > 0 && age <= 16);
  const unique = [...new Set(listed)].sort((a, b) => a - b);
  return unique.length >= 2 ? unique.map(age => `${age} yrs`) : null;
}

// The kind of item a text names: the last item word wins in a name ("Jersey
// scarf" is a scarf, "Shoe stand" a stand), the first in a description.
// undefined when it names none.
function kindIn(source, last) {
  let found;
  let at = last ? -1 : Infinity;
  for (const [kind, pattern] of KINDS) {
    for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
      if (last ? match.index > at : match.index < at) {
        found = kind;
        at = match.index;
      }
    }
  }
  return at === -1 || at === Infinity ? undefined : found;
}

function kindFor(name, description) {
  // The item comes before "with", "and", "for": "Gown with scarf" is a gown,
  // "Fur bag and hat" a bag.
  const head = name.split(/\s(?:with|w\/|plus|and|&|\+|for)\s/)[0];
  for (const [source, last] of [[head, true], [name, true], [description, false]]) {
    const kind = source ? kindIn(source, last) : undefined;
    if (kind !== undefined) return kind;
  }
  // Nothing named, but sizes are: EU shoe sizes ("40-45 boxed", "Green, size
  // 43"), letter sizes ("2 Pcs Set (Sizes S, M, L)") or ages ("3-11yrs").
  const all = `${name} ${description}`;
  if (numberRange(name, 35, 48, 13) || listedNumbers(all, 35, 48)) return 'shoe';
  if (letterSizes(name) || kidsAges(name)) return 'clothing';
  return null;
}

/**
 * The size a buyer must pick for this product, or null when none is needed:
 * { label, options, fromListing }.
 */
export function sizeGuide(product = {}) {
  const category = text(product.category).trim();
  if (!SIZED_CATEGORIES.has(category)) return null;
  const name = text(product.name || product.title);
  const description = text(product.description);
  const all = `${name} ${description}`;
  if (FREE_SIZE.test(all)) return null;
  const kind = kindFor(name, description);
  if (!kind) return null;
  // "Baby tee", "babydoll dress", "baby pink" and "big girl" (a stylish
  // woman) are not children's sizes.
  const kids = String(product.audience || '').toLowerCase() === 'kids'
    || KIDS.test(name.replace(/\bbaby[ -]?(tees?|t-shirts?|dolls?|pink|blue)\b|\bbig girls?\b/g, ''));

  if (kind === 'shoe') {
    const low = kids ? 16 : 30;
    const listed = numberRange(all, low, 48, 14) || listedNumbers(all, low, 48);
    if (listed) return { label: 'Shoe size (EU)', options: listed, fromListing: true };
    const uk = ukShoeSizes(all);
    if (uk) return { label: 'Shoe size (UK)', options: uk, fromListing: true };
    return { label: 'Shoe size (EU)', options: kids ? DEFAULTS.kidsShoe : DEFAULTS.shoe, fromListing: false };
  }
  if (kind === 'ring') {
    // Adjustable rings fit everyone; "Ring fibre 5ft" is not a finger ring.
    if (/\badjustable\b|\bfib(re|er)\b|\d\s*(ft|feet)\b/.test(all)) return null;
    return { label: 'Ring size', options: DEFAULTS.ring, fromListing: false };
  }
  if (kids) {
    const listed = kidsAges(all) || letterSizes(all);
    return { label: 'Age / size', options: listed || DEFAULTS.kids, fromListing: Boolean(listed) };
  }
  const letters = letterSizes(all);
  if (letters) return { label: 'Size', options: letters, fromListing: true };
  // Waist sizes for jeans, trousers and shorts ("30-36").
  if (/\b(jeans?|jorts|trousers?|pants|shorts)\b/.test(name)) {
    const waist = numberRange(all, 24, 48, 16) || listedNumbers(all, 24, 48);
    if (waist) return { label: 'Waist size', options: waist, fromListing: true };
  }
  // Numbered sizes: "UK 8-16", "Size 46-52" (in steps of two when both ends
  // are even, as dress sizes go).
  const numbered = all.match(/\b(uk|sizes?)\s*:?\s*(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/);
  if (numbered) {
    const start = Number(numbered[2]);
    const end = Number(numbered[3]);
    const step = start % 2 === 0 && end % 2 === 0 ? 2 : 1;
    if (end > start && (end - start) / step < 15) {
      const prefix = numbered[1] === 'uk' ? 'UK ' : '';
      const options = [];
      for (let size = start; size <= end; size += step) options.push(`${prefix}${size}`);
      return { label: 'Size', options, fromListing: true };
    }
  }
  return { label: 'Size', options: DEFAULTS.clothing, fromListing: false };
}

/** The listing's photos in display order (main photo first), when there are two or more. */
export function photoOptions(product = {}) {
  const images = (Array.isArray(product.images) ? product.images : []).filter(Boolean);
  const ordered = [product.image_url, ...images].filter(Boolean);
  const unique = ordered.filter((url, index) => ordered.indexOf(url) === index);
  return unique.length >= 2 ? unique : [];
}

/** What the buyer must choose for this product: { size, photo } (each true or false). */
export function requiredChoices(product = {}) {
  return { size: Boolean(sizeGuide(product)), photo: photoOptions(product).length >= 2 };
}

export function needsChoices(product = {}) {
  const required = requiredChoices(product);
  return required.size || required.photo;
}

/** Cleans what the buyer chose: { size, option, option_image, note }. */
export function cleanChoices(choices = {}) {
  const size = String(choices.size || '').replace(/[<>"`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const option = Math.trunc(Number(choices.option));
  const note = String(choices.note || '').replace(/[<>`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    size,
    option: option >= 1 && option <= 30 ? option : null,
    option_image: option >= 1 ? String(choices.option_image || '') : '',
    note,
  };
}

/** What is still missing on a cart line, by the requirements saved on it. */
export function missingChoices(line = {}) {
  const required = line.required_choices || {};
  const choices = line.choices || {};
  const missing = [];
  if (required.size && !choices.size) missing.push('size');
  if (required.photo && !choices.option) missing.push('photo');
  return missing;
}

/** "Size 40 · Option 2 · wine colour" */
export function choiceSummary(choices = {}) {
  const parts = [];
  if (choices.size) parts.push(`Size ${choices.size}`);
  if (choices.option) parts.push(`Option ${choices.option}`);
  if (choices.note) parts.push(choices.note);
  return parts.join(' · ');
}

/** Lines of the same product with the same choices are one cart line. */
export function cartLineKey(line = {}) {
  const choices = line.choices || {};
  return [line.id, choices.size || '', choices.option || '', (choices.note || '').toLowerCase()].join('|');
}
