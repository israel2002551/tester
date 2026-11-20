// Shared by the WhatsApp seller pages at /manage: one item's management link
// (?product=&token=) and a seller's catalog of all their items (?catalog=).
import { useEffect } from 'react';
import { ensureRuntimeConfig, runtimeConfig } from './browserConfig.js';

export async function listingRequest(payload) {
  await ensureRuntimeConfig();
  const config = runtimeConfig();
  const url = String(config.SB_URL || '').replace(/\/+$/, '');
  const key = String(config.SB_KEY || '');
  if (!url || !key) throw new Error('Marketplace configuration is unavailable.');
  const response = await fetch(`${url}/functions/v1/whatsapp-listing-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not manage this listing.');
  return data;
}

export const LISTING_CATEGORIES = [
  ['phones', 'Phones & tablets'],
  ['electronics', 'Electronics & computers'],
  ['fashion', 'Fashion'],
  ['home', 'Home & furniture'],
  ['beauty', 'Beauty & health'],
  ['sports', 'Sports'],
  ['arts', 'Arts & crafts'],
  ['toys & games', 'Toys & games'],
  ['musical instruments', 'Musical instruments'],
  ['vehicles', 'Vehicles'],
  ['services', 'Services & classes'],
  ['dropship', 'Dropship'],
];

// The categories to offer for a listing. One that is not in the list (a new
// import still in "other", or a category BUYSELL gave it) stays selected,
// shown as "Choose a category" or by its own name, so saving keeps it.
export function listingCategoryOptions(current) {
  const value = String(current || 'other');
  if (LISTING_CATEGORIES.some(([key]) => key === value)) return LISTING_CATEGORIES;
  const label = value === 'other' ? 'Choose a category' : value.replace(/\b\w/g, letter => letter.toUpperCase());
  return [[value, label], ...LISTING_CATEGORIES];
}

export const STATE_LABELS = {
  pending: 'In review',
  live: 'Live',
  sold: 'Sold',
  deleted: 'Removed',
};

// These pages hold private links, so search engines should never list them.
export function useNoIndex() {
  useEffect(() => {
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex, nofollow';
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);
}
