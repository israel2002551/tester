import type { Address, Cart, DashboardData, Order, Product } from './types';

const image = (id: string, width = 900) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`;

export const demoCategories = [
  { id: 'cat-home', name: 'Home & Living', slug: 'home-living', icon: 'Armchair', productCount: 1842 },
  { id: 'cat-electronics', name: 'Electronics', slug: 'electronics', icon: 'Headphones', productCount: 3210 },
  { id: 'cat-fashion', name: 'Fashion', slug: 'fashion', icon: 'ShoppingBag', productCount: 4892 },
  { id: 'cat-beauty', name: 'Beauty', slug: 'beauty', icon: 'Sparkles', productCount: 1260 },
  { id: 'cat-grocery', name: 'Groceries', slug: 'groceries', icon: 'ShoppingBasket', productCount: 894 },
  { id: 'cat-phones', name: 'Phones', slug: 'phones-tablets', icon: 'Smartphone', productCount: 968 },
];

const greenMarket = {
  id: 'store-green-market',
  name: 'Green Market Lagos',
  slug: 'green-market-lagos',
  verified: true,
  rating: 4.9,
  responseTime: 'Usually replies within 20 minutes',
};

export const demoProducts: Product[] = [
  {
    id: 'prod-watch', slug: 'active-smart-watch-series-9', name: 'Active Smart Watch Series 9',
    description: 'A refined everyday smartwatch with a bright edge-to-edge display, health tracking and all-day battery life.',
    price: 385000, compareAtPrice: 460000, image: image('photo-1523275335684-37898b6baf30'),
    images: [image('photo-1523275335684-37898b6baf30'), image('photo-1434493789847-2f02dc6ca35d')],
    category: demoCategories[1], store: greenMarket, rating: 4.8, reviewCount: 246, stock: 18, soldPercent: 65, badge: '-16%', location: 'Lagos', variantId: 'variant-watch',
  },
  {
    id: 'prod-bag', slug: 'aurelia-leather-tote', name: 'Aurelia Leather Tote',
    description: 'Structured genuine leather tote with reinforced handles and a soft-lined interior.',
    price: 22500, compareAtPrice: 26500, image: image('photo-1584917865442-de89df76afd3'),
    category: demoCategories[2], store: greenMarket, rating: 4.7, reviewCount: 89, stock: 31, soldPercent: 40, badge: '-15%', location: 'Abuja', variantId: 'variant-bag',
  },
  {
    id: 'prod-earbuds', slug: 'airwave-pro-earbuds', name: 'AirWave Pro Earbuds',
    description: 'Immersive wireless audio with active noise cancellation and a compact charging case.',
    price: 185000, compareAtPrice: 240000, image: image('photo-1606220945770-b5b6c2c55bf1'),
    category: demoCategories[1], store: greenMarket, rating: 4.9, reviewCount: 354, stock: 12, soldPercent: 70, badge: '-23%', location: 'Lagos', variantId: 'variant-earbuds',
  },
  {
    id: 'prod-chair', slug: 'nora-accent-chair', name: 'Nora Accent Chair',
    description: 'A comfortable sculpted accent chair upholstered in a warm, durable textured weave.',
    price: 78000, compareAtPrice: 110000, image: image('photo-1567538096630-e0c55bd6374c'),
    category: demoCategories[0], store: greenMarket, rating: 4.6, reviewCount: 61, stock: 7, soldPercent: 55, badge: '-29%', location: 'Port Harcourt', variantId: 'variant-chair',
  },
  {
    id: 'prod-camera', slug: 'eos-250d-creator-camera', name: 'EOS 250D Creator Camera',
    description: 'A compact creator camera with crisp autofocus, 4K video and an articulating display.',
    price: 620000, image: image('photo-1516035069371-29a1b244cc32'),
    category: demoCategories[1], store: greenMarket, rating: 4.9, reviewCount: 108, stock: 5, location: 'Lagos', variantId: 'variant-camera',
  },
  {
    id: 'prod-sofa', slug: 'adel-two-seater-sofa', name: 'Adel Two-seater Sofa',
    description: 'Modern two-seater sofa with deep cushions and sturdy kiln-dried timber framing.',
    price: 280000, image: image('photo-1555041469-a586c61ea9bc'),
    category: demoCategories[0], store: greenMarket, rating: 4.7, reviewCount: 48, stock: 4, location: 'Lagos', variantId: 'variant-sofa',
  },
  {
    id: 'prod-sneakers', slug: 'orbit-everyday-sneakers', name: 'Orbit Everyday Sneakers',
    description: 'Cushioned lifestyle sneakers designed for easy, all-day movement.',
    price: 45000, image: image('photo-1542291026-7eec264c27ff'),
    category: demoCategories[2], store: greenMarket, rating: 4.5, reviewCount: 120, stock: 24, location: 'Ibadan', variantId: 'variant-sneakers',
  },
  {
    id: 'prod-tv', slug: 'vista-43-smart-tv', name: 'Vista 43-inch Smart TV',
    description: 'Vivid 4K smart television with streaming apps and a slim bezel.',
    price: 310000, image: image('photo-1593359677879-a4bb92f829d1'),
    category: demoCategories[1], store: greenMarket, rating: 4.8, reviewCount: 73, stock: 9, location: 'Lagos', variantId: 'variant-tv',
  },
];

let cartItems = [{ id: 'cart-watch', quantity: 1, product: demoProducts[0]! }];

const subtotal = () => cartItems.reduce((total, item) => total + Number(item.product.price) * item.quantity, 0);

export const demoAddresses: Address[] = [
  { id: 'address-home', label: 'Home', fullName: 'Ada Nwosu', phone: '+234 803 555 0142', addressLine1: '14 Admiralty Way, Lekki Phase 1', city: 'Lekki', state: 'Lagos', isDefault: true },
];

export const demoOrders: Order[] = [
  { id: 'order-1', orderNumber: 'BS-10482', status: 'IN_TRANSIT', createdAt: '2026-08-08T10:20:00Z', total: 407500, itemCount: 2, thumbnail: demoProducts[0]!.image, storeName: greenMarket.name },
  { id: 'order-2', orderNumber: 'BS-10391', status: 'DELIVERED', createdAt: '2026-07-28T13:04:00Z', total: 78000, itemCount: 1, thumbnail: demoProducts[3]!.image, storeName: greenMarket.name },
];

const sellerDashboard: DashboardData = {
  metrics: [
    { label: 'Net sales', value: '₦4.82m', change: '+18.4%', trend: 'up' },
    { label: 'Orders', value: '286', change: '+12.1%', trend: 'up' },
    { label: 'Conversion', value: '4.8%', change: '+0.6%', trend: 'up' },
    { label: 'Available balance', value: '₦1.24m', change: 'Ready to withdraw', trend: 'neutral' },
  ],
  chart: [22, 36, 31, 48, 43, 56, 51, 71, 66, 78, 73, 88],
  rows: [
    { id: '1', primary: 'BS-10531', secondary: '3 items · Ada Nwosu', status: 'Processing', value: '₦184,500', date: 'Today, 10:42' },
    { id: '2', primary: 'BS-10528', secondary: '1 item · Tunde Salami', status: 'Ready', value: '₦78,000', date: 'Today, 09:18' },
    { id: '3', primary: 'BS-10514', secondary: '2 items · Maya Okafor', status: 'In transit', value: '₦407,500', date: 'Yesterday' },
  ],
};

const adminDashboard: DashboardData = {
  metrics: [
    { label: 'Gross merchandise value', value: '₦82.4m', change: '+14.8%', trend: 'up' },
    { label: 'Platform revenue', value: '₦5.76m', change: '+11.2%', trend: 'up' },
    { label: 'Active sellers', value: '1,248', change: '+68 this month', trend: 'up' },
    { label: 'Open cases', value: '23', change: '5 urgent', trend: 'down' },
  ],
  chart: [28, 33, 42, 38, 55, 61, 58, 69, 75, 72, 84, 91],
  rows: [
    { id: '1', primary: 'New seller verification', secondary: 'Cedar Home NG', status: 'Review', date: '8 minutes ago' },
    { id: '2', primary: 'Payout batch requested', secondary: '18 seller accounts', status: 'Pending', value: '₦3.9m', date: '22 minutes ago' },
    { id: '3', primary: 'Buyer dispute escalated', secondary: 'Case DSP-2084', status: 'Urgent', value: '₦185,000', date: '1 hour ago' },
  ],
};

export function getDemoCart(): Cart {
  return { id: 'demo-cart', items: [...cartItems], itemCount: cartItems.reduce((total, item) => total + item.quantity, 0), subtotal: subtotal() };
}

export async function demoResponse(path: string, init?: RequestInit): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 140));
  const url = new URL(path, 'https://demo.local');
  const normalized = url.pathname.replace(/^\/api\/v1/, '');
  const method = (init?.method ?? 'GET').toUpperCase();

  if (normalized === '/catalog/home') return { categories: demoCategories, deals: demoProducts.slice(0, 4), featured: demoProducts.slice(4), recentlyViewed: demoProducts.slice(1, 5) };
  if (normalized === '/catalog/categories') return { items: demoCategories };
  if (normalized === '/catalog/products' || normalized === '/catalog/search') {
    const term = (url.searchParams.get('q') ?? '').toLowerCase();
    const category = url.searchParams.get('category');
    const items = demoProducts.filter((product) => (!term || product.name.toLowerCase().includes(term)) && (!category || (typeof product.category !== 'string' && product.category?.slug === category)));
    return { items, total: items.length, page: 1, pageSize: 24, totalPages: 1 };
  }
  if (normalized.startsWith('/catalog/products/')) {
    const slug = normalized.split('/').pop();
    return demoProducts.find((product) => product.slug === slug || product.id === slug) ?? demoProducts[0];
  }
  if (normalized.startsWith('/catalog/stores/')) return { ...greenMarket, description: 'Curated everyday essentials, dispatched quickly from Lagos.', products: demoProducts };
  if (normalized === '/cart' && method === 'GET') return getDemoCart();
  if (normalized.startsWith('/cart/items/') && method === 'PUT') {
    const input = JSON.parse(String(init?.body ?? '{}')) as { productId: string; quantity?: number };
    const variantId = normalized.split('/').pop();
    const product = demoProducts.find((item) => item.variantId === variantId || item.id === variantId) ?? demoProducts[0]!;
    const current = cartItems.find((item) => item.product.id === product.id);
    if (current) current.quantity = input.quantity ?? 1;
    else cartItems.push({ id: `cart-${product.id}`, quantity: input.quantity ?? 1, product });
    return getDemoCart();
  }
  if (normalized.startsWith('/cart/items/') && method === 'DELETE') {
    const id = normalized.split('/').pop();
    cartItems = cartItems.filter((item) => item.id !== id);
    return getDemoCart();
  }
  if (normalized === '/account/addresses') return { items: demoAddresses };
  if (normalized === '/checkout/quotes') return { id: 'quote-demo', subtotal: subtotal(), deliveryFee: 3500, discount: 0, total: subtotal() + 3500, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  if (normalized === '/orders' && method === 'GET') return { items: demoOrders };
  if (normalized.startsWith('/orders/')) return demoOrders.find((order) => order.id === normalized.split('/').pop()) ?? demoOrders[0];
  if (normalized === '/orders' && method === 'POST') return { id: 'order-demo-new', orderNumber: 'BS-10542', status: 'PENDING_PAYMENT', total: subtotal() + 3500 };
  if (normalized.includes('/dashboard') || normalized.includes('/analytics')) return normalized.startsWith('/admin') ? adminDashboard : sellerDashboard;
  if (normalized === '/auth/me') return { id: 'demo-user', email: 'demo@buysell.ng', displayName: 'Ada Nwosu', platformRoles: ['BUYER'], storeMemberships: [] };
  if (normalized.startsWith('/services/')) return { id: normalized.split('/').pop(), name: 'Home appliance installation', provider: 'Fixright Services', rating: 4.9, price: 18500, location: 'Lagos', status: 'Available', description: 'Professional installation, safety checks and a tidy handover for your new home appliance.' };
  if (normalized.startsWith('/services')) return { items: [
    { id: 'service-1', name: 'Home appliance installation', provider: 'Fixright Services', rating: 4.9, price: 18500, location: 'Lagos', status: 'Available' },
    { id: 'service-2', name: 'Product photography', provider: 'Framehouse Studio', rating: 4.8, price: 45000, location: 'Abuja', status: 'Available' },
  ] };
  if (normalized.startsWith('/rfq')) return { items: [
    { id: 'rfq-1', name: 'Branded reusable water bottles', quantity: '500 units', status: 'Open', value: '3 quotes', date: 'Closes 18 Aug' },
    { id: 'rfq-2', name: 'Office task chairs', quantity: '80 units', status: 'Review', value: '6 quotes', date: 'Closes 14 Aug' },
  ] };
  if (normalized.startsWith('/sourcing')) return { items: [
    { id: 'src-1', name: 'Custom cotton tote bags', quantity: '1,000 units', status: 'Quote ready', value: '₦2.48m', date: 'Updated today' },
    { id: 'src-2', name: 'Restaurant dinnerware set', quantity: '250 sets', status: 'Under review', value: 'Awaiting quote', date: 'Updated yesterday' },
  ] };
  if (/^\/(seller|supplier|admin)\//.test(normalized) || normalized === '/admin') return sellerDashboard;
  if (method !== 'GET') return { id: `demo-${Date.now()}`, ok: true };
  return { items: [] };
}
