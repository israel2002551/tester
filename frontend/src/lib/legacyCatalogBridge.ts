import { api } from './api';
import { supabase } from './supabase';
import type { Category, Product, PageResult } from './types';

type LegacyProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number | string | null;
  original_price: number | string | null;
  category: string | null;
  condition: string | null;
  location: string | null;
  image_url: string | null;
  images: unknown;
  stock_quantity: number | null;
  status: string | null;
  avg_rating: number | string | null;
  review_count: number | null;
  seller_verified: boolean | null;
  seller_id: string | null;
  shipping_fee: number | string | null;
  created_at: string | null;
  profiles?: {
    id: string;
    name: string | null;
    store_name: string | null;
    seller_verified: boolean | null;
    logo_url: string | null;
    store_address: string | null;
  } | null;
};

const CATEGORY_LABELS: Record<string, { name: string; slug: string }> = {
  phones: { name: 'Phones & Tablets', slug: 'phones-tablets' },
  electronics: { name: 'Electronics', slug: 'electronics' },
  fashion: { name: 'Fashion', slug: 'fashion' },
  home: { name: 'Home & Living', slug: 'home-living' },
  beauty: { name: 'Beauty & Health', slug: 'beauty-health' },
  sports: { name: 'Sports & Outdoors', slug: 'sports-outdoors' },
  dropship: { name: 'Other', slug: 'other' },
  other: { name: 'Other', slug: 'other' },
};

const PRODUCT_SELECT = [
  'id', 'name', 'description', 'price', 'original_price', 'category', 'condition',
  'location', 'image_url', 'images', 'stock_quantity', 'status', 'avg_rating',
  'review_count', 'seller_verified', 'seller_id', 'shipping_fee', 'created_at',
].join(',');

const PRODUCT_PATH = /^\/catalog\/products\/([^/?#]+)$/;

function categoryInfo(value: string | null | undefined) {
  return CATEGORY_LABELS[value ?? 'other'] ?? CATEGORY_LABELS.other;
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function normalizeImages(value: unknown, fallback?: string | null) {
  const images = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  if (!images.length && fallback) images.push(fallback);
  return [...new Set(images)];
}

function toProduct(row: LegacyProduct): Product {
  const category = categoryInfo(row.category);
  const images = normalizeImages(row.images, row.image_url);
  const seller = row.profiles;
  const storeName = seller?.store_name || seller?.name || 'BUYSELL seller';
  return {
    id: row.id,
    slug: `legacy-${row.id}`,
    name: row.name,
    description: row.description ?? undefined,
    price: Number(row.price ?? 0),
    compareAtPrice: row.original_price == null ? null : Number(row.original_price),
    currency: 'NGN',
    image: images[0],
    images,
    category: { id: category.slug, name: category.name, slug: category.slug },
    store: { id: String(row.seller_id ?? 'legacy-seller'), name: storeName, slug: slugify(storeName), verified: Boolean(row.seller_verified ?? seller?.seller_verified) },
    rating: row.avg_rating == null ? undefined : Number(row.avg_rating),
    reviewCount: Number(row.review_count ?? 0),
    stock: Number(row.stock_quantity ?? 0),
    location: row.location ?? seller?.store_address ?? undefined,
    variantId: `legacy-${row.id}`,
    shippingFee: Number(row.shipping_fee ?? 0),
  };
}

async function loadProducts(params: URLSearchParams) {
  if (!supabase) throw new Error('Marketplace data connection is not configured.');

  let query = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('status', 'active');

  const search = params.get('q')?.trim();
  const category = params.get('category');
  const condition = params.get('condition');
  const minKobo = Number(params.get('minPriceKobo') ?? '');
  const maxKobo = Number(params.get('maxPriceKobo') ?? '');

  if (search) query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  if (category) {
    const legacyCategory = Object.entries(CATEGORY_LABELS).find(([, value]) => value.slug === category)?.[0];
    if (legacyCategory && legacyCategory !== 'other') query = query.eq('category', legacyCategory);
    else if (category === 'other') query = query.in('category', ['other', 'dropship']);
  }
  if (condition === 'NEW') query = query.eq('condition', 'new');
  if (condition === 'USED') query = query.in('condition', ['used-like-new', 'used-good']);
  if (condition === 'REFURBISHED') query = query.eq('condition', 'refurbished');
  if (Number.isFinite(minKobo) && minKobo > 0) query = query.gte('price', minKobo / 100);
  if (Number.isFinite(maxKobo) && maxKobo > 0) query = query.lte('price', maxKobo / 100);

  const sort = params.get('sort');
  if (sort === 'name') query = query.order('name', { ascending: true });
  else if (sort === 'oldest') query = query.order('created_at', { ascending: true });
  else query = query.order('created_at', { ascending: false });

  const page = Math.max(1, Number(params.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params.get('limit') ?? 24)));
  query = query.range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as LegacyProduct[];
  const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter((id): id is string => Boolean(id)))];
  const profiles = sellerIds.length
    ? await supabase.from('profiles').select('id,name,store_name,seller_verified,logo_url,store_address').in('id', sellerIds)
    : { data: [], error: null };
  if (profiles.error) throw profiles.error;

  const profileMap = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const products = rows.map((row) => toProduct({ ...row, profiles: row.seller_id ? profileMap.get(row.seller_id) ?? null : null }));
  const total = count ?? products.length;

  return {
    items: products,
    page,
    pageSize: limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  } satisfies PageResult<Product>;
}

async function loadHome(): Promise<{ categories: Category[]; products: Product[]; campaigns: never[] }> {
  if (!supabase) throw new Error('Marketplace data connection is not configured.');
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT, { count: 'exact' }).eq('status', 'active').order('created_at', { ascending: false }).limit(24);
  if (error) throw error;
  const rows = (data ?? []) as unknown as LegacyProduct[];
  const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter((id): id is string => Boolean(id)))];
  const profiles = sellerIds.length
    ? await supabase.from('profiles').select('id,name,store_name,seller_verified,logo_url,store_address').in('id', sellerIds)
    : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const profileMap = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const products = rows.map((row) => toProduct({ ...row, profiles: row.seller_id ? profileMap.get(row.seller_id) ?? null : null }));

  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const key = categoryInfo(row.category).slug;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const categories = Object.values(CATEGORY_LABELS)
    .filter((category, index, all) => all.findIndex((candidate) => candidate.slug === category.slug) === index)
    .map((category) => ({
      id: category.slug,
      name: category.name,
      slug: category.slug,
      productCount: counts.get(category.slug) ?? 0,
    }))
    .filter((category) => category.productCount > 0);

  return { categories, products, campaigns: [] };
}

async function loadProduct(identifier: string) {
  if (!supabase) throw new Error('Marketplace data connection is not configured.');
  const id = identifier.startsWith('legacy-') ? identifier.slice('legacy-'.length) : identifier;
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).eq('status', 'active').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Product could not be found.');
  const row = data as unknown as LegacyProduct;
  let profile = null;
  if (row.seller_id) {
    const result = await supabase.from('profiles').select('id,name,store_name,seller_verified,logo_url,store_address').eq('id', row.seller_id).maybeSingle();
    if (result.error) throw result.error;
    profile = result.data;
  }
  return toProduct({ ...row, profiles: profile });
}

async function loadStore(slug: string) {
  if (!supabase) throw new Error('Marketplace data connection is not configured.');
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,name,store_name,store_description,seller_verified,logo_url,store_address').not('store_name', 'is', null).ilike('store_name', `%${slug.replace(/-/g, ' ')}%`).limit(1);
  if (profileError) throw profileError;
  const profile = profiles?.[0];
  if (!profile) throw new Error('Store could not be found.');
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('seller_id', profile.id).eq('status', 'active').order('created_at', { ascending: false });
  if (error) throw error;
  return {
    store: { id: profile.id, slug: slugify(profile.store_name ?? profile.name ?? profile.id), name: profile.store_name ?? profile.name ?? 'BUYSELL seller', description: profile.store_description ?? undefined, location: profile.store_address ?? undefined, logoUrl: profile.logo_url ?? undefined, bannerUrl: undefined },
    products: ((data ?? []) as unknown as LegacyProduct[]).map((row) => toProduct({ ...row, profiles: profile })),
  };
}

export async function legacyCatalogGet<T>(path: string): Promise<T | null> {
  if (!supabase) return null;
  const parsed = new URL(path, 'https://buysell.local');
  const pathname = parsed.pathname;
  try {
    if (pathname === '/catalog/home') return await loadHome() as T;
    if (pathname === '/catalog/products' || pathname === '/catalog/search') return await loadProducts(parsed.searchParams) as T;
    const productMatch = pathname.match(PRODUCT_PATH);
    if (productMatch) return await loadProduct(decodeURIComponent(productMatch[1]!)) as T;
    const storeMatch = pathname.match(/^\/catalog\/stores\/([^/?#]+)$/);
    if (storeMatch) return await loadStore(decodeURIComponent(storeMatch[1]!)) as T;
    return null;
  } catch {
    return null;
  }
}

const originalGet = api.get.bind(api);
api.get = async <T>(path: string, options = {}) => {
  const result = await originalGet<T>(path, options);
  if (path.startsWith('/catalog/') && isCatalogResultEmpty(result)) {
    return (await legacyCatalogGet<T>(path)) ?? result;
  }
  return result;
};

function isCatalogResultEmpty(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items.length === 0;
  if (Array.isArray(record.deals)) return record.deals.length === 0;
  if (Array.isArray(record.products)) return record.products.length === 0;
  return false;
}
