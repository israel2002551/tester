import { demoResponse } from './demo';
import type { Address, Cart, Order, Product, Viewer } from './types';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

let accessTokenProvider: () => Promise<string | null> = async () => null;

export function registerAccessTokenProvider(provider: () => Promise<string | null>) {
  accessTokenProvider = provider;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  anonymous?: boolean;
  idempotencyKey?: string;
}

type JsonRecord = Record<string, any>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function majorFromKobo(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount / 100 : 0;
}

export function normalizeProduct(input: unknown): Product {
  const product = asRecord(input);
  if ('price' in product && !product.variants) return product as Product;
  const variant = Array.isArray(product.variants) ? asRecord(product.variants[0]) : asRecord(product.variant);
  const media = Array.isArray(product.media) ? product.media : [];
  const images = media.map((entry: unknown) => {
    const item = asRecord(entry);
    return item.url ?? asRecord(item.asset).publicUrl;
  }).filter(Boolean) as string[];
  const inventory = asRecord(variant.inventory);
  const available = variant.available ?? Math.max(0, Number(inventory.onHand ?? 0) - Number(inventory.reserved ?? 0));
  const store = asRecord(product.store);
  return {
    id: String(product.id ?? ''),
    slug: String(product.slug ?? product.id ?? ''),
    name: String(product.name ?? 'Untitled product'),
    description: product.description ?? undefined,
    price: majorFromKobo(variant.priceKobo),
    compareAtPrice: variant.compareAtKobo == null ? null : majorFromKobo(variant.compareAtKobo),
    currency: 'NGN',
    image: images[0],
    images,
    category: product.category,
    store: store.id ? { id: String(store.id), name: String(store.name ?? 'Marketplace store'), slug: String(store.slug ?? store.id), verified: false } : undefined,
    rating: product.rating == null ? undefined : Number(product.rating),
    reviewCount: Number(product.reviewCount ?? 0),
    stock: Number(available),
    location: store.location ?? product.location ?? undefined,
    variantId: variant.id ? String(variant.id) : undefined,
    shippingFee: majorFromKobo(product.shippingFeeKobo),
  };
}

function normalizeAddress(input: unknown): Address {
  const address = asRecord(input);
  return {
    id: String(address.id ?? ''),
    label: String(address.label ?? (address.isDefault ? 'Default address' : 'Address')),
    fullName: String(address.fullName ?? address.recipientName ?? ''),
    phone: String(address.phone ?? ''),
    addressLine1: String(address.addressLine1 ?? address.line1 ?? ''),
    city: String(address.city ?? ''),
    state: String(address.state ?? ''),
    isDefault: Boolean(address.isDefault),
  };
}

function normalizeCart(input: unknown): Cart {
  const cart = asRecord(input);
  const items = (Array.isArray(cart.items) ? cart.items : []).map((entry: unknown) => {
    const item = asRecord(entry);
    const variant = asRecord(item.variant);
    const productSource = asRecord(item.product);
    const product = normalizeProduct({ ...productSource, media: productSource.media ?? item.media, variants: [variant] });
    return { id: String(variant.id ?? item.variantId ?? item.id), variantId: String(variant.id ?? item.variantId ?? ''), quantity: Number(item.quantity ?? 1), product };
  });
  return {
    id: cart.id,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0),
  };
}

function normalizeOrder(input: unknown): Order {
  const order = asRecord(input);
  if ('total' in order && !('totalKobo' in order)) return order as Order;
  const storeOrders = Array.isArray(order.storeOrders) ? order.storeOrders.map(asRecord) : [];
  const itemCount = Array.isArray(order.items)
    ? order.items.reduce((sum: number, item: unknown) => sum + Number(asRecord(item).quantity ?? 0), 0)
    : storeOrders.reduce((sum: number, storeOrder: JsonRecord) => sum + (Array.isArray(storeOrder.items) ? storeOrder.items.reduce((inner: number, item: unknown) => inner + Number(asRecord(item).quantity ?? 0), 0) : 0), 0);
  return {
    id: String(order.id ?? ''),
    orderNumber: String(order.orderNumber ?? order.id ?? ''),
    status: String(order.status ?? 'PENDING_PAYMENT'),
    createdAt: String(order.placedAt ?? order.createdAt ?? new Date().toISOString()),
    total: majorFromKobo(order.totalKobo),
    itemCount,
    storeName: storeOrders.map((entry: JsonRecord) => asRecord(entry.store).name).filter(Boolean).join(', ') || undefined,
  };
}

function normalizeViewer(input: unknown): Viewer {
  const viewer = asRecord(input);
  const profile = asRecord(viewer.profile);
  return {
    id: String(viewer.id ?? ''),
    email: String(viewer.email ?? ''),
    displayName: String(viewer.displayName ?? profile.displayName ?? viewer.email?.split('@')[0] ?? 'BUYSELL member'),
    platformRoles: Array.isArray(viewer.platformRoles) ? viewer.platformRoles.map((role: unknown) => typeof role === 'string' ? role : String(asRecord(role).role)) : [],
    storeMemberships: Array.isArray(viewer.storeMemberships) ? viewer.storeMemberships.map((membership: unknown) => {
      const member = asRecord(membership);
      const store = asRecord(member.store);
      return { storeId: String(member.storeId ?? store.id ?? ''), storeName: String(member.storeName ?? store.name ?? 'Store'), permissions: Array.isArray(member.permissions) ? member.permissions.map((permission: unknown) => typeof permission === 'string' ? permission : String(asRecord(permission).permission)) : [] };
    }) : [],
  };
}

function normalizeDashboard(path: string, input: unknown) {
  const data = asRecord(input);
  if (Array.isArray(data.metrics)) return data;
  if (path.includes('/admin/dashboard')) return {
    metrics: [
      { label: 'Gross merchandise value', value: `₦${majorFromKobo(data.grossMerchandiseKobo).toLocaleString('en-NG')}` },
      { label: 'New orders', value: Number(data.newOrders ?? 0).toLocaleString('en-NG') },
      { label: 'Marketplace stores', value: Number(data.stores ?? 0).toLocaleString('en-NG') },
      { label: 'New users', value: Number(data.newUsers ?? 0).toLocaleString('en-NG') },
    ],
    rows: [
      { id: 'open-disputes', primary: 'Open disputes', secondary: 'Cases awaiting resolution', status: Number(data.openDisputes ?? 0) ? 'Needs attention' : 'Clear', value: String(data.openDisputes ?? 0) },
      { id: 'pending-kyc', primary: 'Pending verification', secondary: 'Submissions awaiting review', status: Number(data.pendingKyc ?? 0) ? 'Review' : 'Clear', value: String(data.pendingKyc ?? 0) },
      { id: 'active-sourcing', primary: 'Active sourcing', secondary: 'Requests in progress', status: 'Active', value: String(data.activeSourcing ?? 0) },
    ],
  };
  return {
    metrics: [
      { label: 'Net sales', value: `₦${majorFromKobo(data.revenueKobo).toLocaleString('en-NG')}` },
      { label: 'Orders to process', value: Number(data.pendingOrders ?? 0).toLocaleString('en-NG') },
      { label: 'Products', value: Number(data.productCount ?? data.activeProducts ?? 0).toLocaleString('en-NG') },
      { label: 'Low stock', value: Number(data.lowStock ?? 0).toLocaleString('en-NG') },
    ],
    rows: [],
  };
}

function normalizeService(input: unknown) {
  const service = asRecord(input);
  const provider = asRecord(service.provider);
  const profile = asRecord(provider.profile);
  return { ...service, name: service.name ?? service.title, provider: service.providerName ?? profile.displayName ?? provider.email ?? 'Service provider', price: 'price' in service ? service.price : majorFromKobo(service.startingKobo), rating: service.rating ?? undefined };
}

function normalizeListItem(input: unknown) {
  const item = asRecord(input);
  if (item.orderNumber) return { ...item, primary: item.orderNumber, secondary: asRecord(item.order).orderNumber ?? item.buyerId, value: item.totalKobo != null ? `₦${majorFromKobo(item.totalKobo).toLocaleString('en-NG')}` : undefined };
  if (item.requestNumber) return { ...item, name: item.items?.[0]?.title ?? item.requestNumber, quantity: item.items?.[0]?.quantity ? `${item.items[0].quantity} units` : undefined, value: item.quotes?.[0]?.totalKobo ? `₦${majorFromKobo(item.quotes[0].totalKobo).toLocaleString('en-NG')}` : 'Awaiting quote', date: item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('en-NG') : undefined };
  if (item.subject) return { ...item, name: item.subject, status: item.status ?? 'Draft' };
  if (item.costKobo != null) return { ...item, value: `₦${majorFromKobo(item.costKobo).toLocaleString('en-NG')}` };
  return item;
}

function normalizePayload(path: string, input: unknown, meta?: JsonRecord): unknown {
  const pathname = new URL(path, 'https://buysell.local').pathname.replace(/^\/api\/v1/, '');
  if (pathname === '/auth/me') return normalizeViewer(input);
  if (pathname === '/home' || pathname === '/catalog/home') {
    const home = asRecord(input);
    const products = Array.isArray(home.products) ? home.products.map(normalizeProduct) : [];
    return { categories: home.categories ?? [], deals: products.slice(0, 4), featured: products.slice(4), campaigns: home.campaigns ?? [] };
  }
  if (/^\/(catalog\/)?products\/[A-Za-z0-9-]+$/.test(pathname)) return normalizeProduct(input);
  if (pathname === '/products' || pathname === '/catalog/products' || pathname === '/catalog/search') {
    const items = Array.isArray(input) ? input.map(normalizeProduct) : [];
    return { items, page: meta?.page, pageSize: meta?.limit, total: meta?.total ?? items.length, totalPages: meta?.pages };
  }
  if (/^\/(catalog\/)?stores\//.test(pathname)) {
    const data = asRecord(input);
    const store = asRecord(data.store);
    return { ...store, verified: false, products: Array.isArray(data.products) ? data.products.map(normalizeProduct) : [] };
  }
  if (pathname === '/cart') return normalizeCart(input);
  if (pathname.startsWith('/checkout/quotes')) {
    const quote = asRecord(input);
    return { ...quote, subtotal: majorFromKobo(quote.subtotalKobo), deliveryFee: majorFromKobo(quote.shippingKobo), discount: majorFromKobo(quote.discountKobo), total: majorFromKobo(quote.totalKobo) };
  }
  if (pathname === '/orders' && Array.isArray(input)) {
    const items = input.map(normalizeOrder);
    return { items, page: meta?.page, pageSize: meta?.limit, total: meta?.total ?? items.length, totalPages: meta?.pages };
  }
  if (/^\/orders\/[^/]+$/.test(pathname)) return normalizeOrder(input);
  if (pathname === '/account/addresses' && Array.isArray(input)) return { items: input.map(normalizeAddress) };
  if (pathname === '/wishlist') {
    const wishlist = asRecord(input);
    return { items: (Array.isArray(wishlist.items) ? wishlist.items : []).map((entry: unknown) => normalizeProduct(asRecord(entry).product)) };
  }
  if (pathname === '/conversations' && Array.isArray(input)) {
    return { items: input.map((entry: unknown) => { const member = asRecord(entry); const conversation = asRecord(member.conversation); const other = (conversation.members ?? []).map((entry: unknown) => asRecord(asRecord(entry).user)).find((user: JsonRecord) => user.id !== member.userId); const latest = conversation.messages?.[0]; return { id: conversation.id, primary: asRecord(other?.profile).displayName ?? other?.email ?? 'Conversation', secondary: latest?.body ?? 'Open conversation', date: conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleDateString('en-NG') : '' }; }) };
  }
  if (/^\/conversations\/[^/]+\/messages$/.test(pathname) && Array.isArray(input)) return { items: input.map((entry: unknown) => { const message = asRecord(entry); return { id: message.id, body: message.body, sentAt: message.createdAt ? new Date(message.createdAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '', own: false }; }) };
  if (pathname === '/services' && Array.isArray(input)) return { items: input.map(normalizeService) };
  if (pathname.startsWith('/seller/') && pathname.endsWith('/dashboard') || pathname === '/admin/dashboard') return normalizeDashboard(pathname, input);
  if (Array.isArray(input)) {
    const items = input.map(normalizeListItem);
    return { items, page: meta?.page, pageSize: meta?.limit, total: meta?.total ?? items.length, totalPages: meta?.pages };
  }
  return input;
}

let selectedStoreId: string | null = null;

async function fetchStoreId(headers: Headers): Promise<string> {
  if (selectedStoreId) return selectedStoreId;
  const response = await fetch(`${apiBaseUrl}/seller/stores`, { headers, credentials: 'same-origin' });
  if (!response.ok) throw new ApiError('We could not load your seller workspace.', response.status, 'STORE_CONTEXT_UNAVAILABLE');
  const payload = await response.json();
  const stores = Array.isArray(payload.data) ? payload.data : [];
  const store = stores[0];
  if (!store?.id) throw new ApiError('Finish seller onboarding before opening this workspace.', 409, 'STORE_REQUIRED');
  selectedStoreId = String(store.id);
  return selectedStoreId;
}

async function resolveBackendPath(path: string, method: string, headers: Headers): Promise<string> {
  const parsed = new URL(path, 'https://buysell.local');
  let pathname = parsed.pathname;
  if (pathname.startsWith('/catalog/')) pathname = pathname.replace('/catalog', '');
  if (pathname === '/search') pathname = '/products';
  if (pathname === '/messages') pathname = '/conversations';
  else if (/^\/messages\/[^/]+$/.test(pathname)) pathname = `/conversations/${pathname.split('/').pop()}/messages`;
  if (pathname === '/rfq') pathname = '/rfqs';
  if (pathname === '/seller/onboarding') pathname = '/seller/onboarding/store';
  if (pathname === '/seller/store' && method === 'GET') pathname = '/seller/stores';
  if (pathname.startsWith('/seller/sourcing')) pathname = pathname.replace('/seller/sourcing', '/sourcing');
  if (pathname === '/seller/messages') pathname = '/conversations';
  if (pathname === '/seller/referrals') pathname = '/referrals';
  if (pathname === '/seller/verification') pathname = '/kyc';
  if (pathname.startsWith('/supplier/catalog')) pathname = pathname.replace('/supplier/catalog', '/supplier/products');
  if (pathname.startsWith('/supplier/requests')) pathname = pathname.replace('/supplier/requests', '/supplier/rfqs');
  if (pathname === '/admin/sellers') pathname = '/admin/stores';
  if (pathname.startsWith('/admin/advertising')) pathname = pathname.replace('/admin/advertising', '/admin/ads');
  if (pathname === '/admin/audit-logs') pathname = '/admin/audit';
  if (pathname === '/admin/finance' || pathname === '/admin/commissions') pathname = '/admin/finance/ledger';

  const sellerMatch = pathname.match(/^\/seller\/(dashboard|products(?:\/[^/]+)?|inventory|orders(?:\/[^/]+)?|customers|analytics|finance|payouts|team|advertising|settings)(.*)$/);
  if (sellerMatch) {
    const storeId = await fetchStoreId(headers);
    const sectionMap: Record<string, string> = { payouts: 'finance', advertising: 'ads', customers: 'orders', inventory: 'products' };
    const base = sellerMatch[1]!.split('/')[0]!;
    const rest = sellerMatch[1]!.slice(base.length) + sellerMatch[2]!;
    pathname = `/seller/${storeId}/${sectionMap[base] ?? base}${rest}`;
  }
  return `${pathname}${parsed.search}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

  if (!options.anonymous) {
    const token = await accessTokenProvider();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  if (demoMode) {
    return demoResponse(`${apiBaseUrl}${normalizedPath}`, { ...options, headers }) as Promise<T>;
  }

  const backendPath = await resolveBackendPath(normalizedPath, (options.method ?? 'GET').toUpperCase(), headers);
  const url = `${apiBaseUrl}${backendPath}`;

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Unable to reach BUYSELL', 0, 'NETWORK_ERROR');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const payload = body && typeof body === 'object' ? body as Record<string, any> : {};
    const failure = payload.error ?? payload;
    throw new ApiError(failure.message ?? `Request failed with status ${response.status}`, response.status, failure.code, failure.details);
  }

  if (body && typeof body === 'object' && 'data' in body) {
    const envelope = body as { data: unknown; meta?: JsonRecord };
    return normalizePayload(backendPath, envelope.data, envelope.meta) as T;
  }
  return normalizePayload(backendPath, body) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};
