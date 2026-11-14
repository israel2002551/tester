// Search by photo, shared by the marketplace (app.js reads it as
// window.BuysellImageSearch), the category pages and the landing page.
//
// The photo is shrunk in the browser and sent to the image-search edge
// function, which says what product it shows ("black leather handbag"). That
// text is then searched like a typed search, so shoppers can see and edit it.
import { ensureRuntimeConfig, runtimeConfig } from './browserConfig.js';
import { normalizeSearchQuery, searchProducts } from './productSearch.js';

const MAX_SIDE = 1024;
const THUMBNAIL_SIDE = 120;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class PhotoSearchError extends Error {}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoSearchError("Couldn't open that photo. Try a JPG or PNG photo."));
    };
    image.src = url;
  });
}

function shrink(image, maxSide, quality) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  // Transparent PNGs turn black as JPEG without a background.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** The photo, shrunk for sending, and a small thumbnail to show beside the results. */
export async function preparePhoto(file) {
  if (!file) throw new PhotoSearchError('Choose a photo to search with.');
  if (file.type && !file.type.startsWith('image/')) throw new PhotoSearchError('That file is not a photo.');
  if (file.size > MAX_FILE_BYTES) throw new PhotoSearchError('That photo is too large. Try a smaller one.');
  const image = await loadImage(file);
  return { image: shrink(image, MAX_SIDE, 0.82), thumbnail: shrink(image, THUMBNAIL_SIDE, 0.7) };
}

/** What the photo shows: { query, item, category, audience, brand, colors }. */
export async function describePhoto(image) {
  await ensureRuntimeConfig();
  const config = runtimeConfig();
  const url = String(config.SB_URL || '').replace(/\/+$/, '');
  const key = String(config.SB_KEY || '');
  if (!url || !key) throw new PhotoSearchError("Photo search isn't available right now. Please type your search instead.");
  let response;
  try {
    response = await fetch(`${url}/functions/v1/image-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ image }),
    });
  } catch {
    throw new PhotoSearchError('No connection. Check your internet and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PhotoSearchError(data.error || "Photo search isn't available right now. Please type your search instead.");
  if (!data.found) throw new PhotoSearchError("We couldn't spot a product in that photo. Try a clear photo of just the item.");
  return data;
}

/**
 * The search to run for a photo: its full description when listings match it,
 * else the colour and kind of item, else just the kind of item.
 */
export function photoSearchQuery(rows, analysis = {}) {
  const item = normalizeSearchQuery(analysis.item);
  const candidates = [
    normalizeSearchQuery(analysis.query),
    normalizeSearchQuery([analysis.colors?.[0], item].filter(Boolean).join(' ')),
    item,
  ].filter((query, index, all) => query && all.indexOf(query) === index);
  return candidates.find(query => searchProducts(rows, query).items.length) || candidates[0] || '';
}

// A photo search started on another page (the landing page) hands its thumbnail
// to the marketplace for this tab only, so the results can say where they came from.
const HANDOFF_KEY = 'bs_photo_search';

export function rememberPhotoSearch(query, thumbnail) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ query: normalizeSearchQuery(query), thumbnail }));
  } catch {
    // Storage can be full or blocked; the search still works without the thumbnail.
  }
}

/** The handed-over photo search for `query`, once: { query, thumbnail } or null. */
export function takeRememberedPhotoSearch(query) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
    sessionStorage.removeItem(HANDOFF_KEY);
    return saved && saved.query === normalizeSearchQuery(query) ? saved : null;
  } catch {
    return null;
  }
}

/** Shrinks the photo, asks what it shows and returns that with a thumbnail. */
export async function searchByPhoto(file) {
  const { image, thumbnail } = await preparePhoto(file);
  const analysis = await describePhoto(image);
  return { ...analysis, thumbnail };
}
