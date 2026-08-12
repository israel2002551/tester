export type MoneyValue = number | string;

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  image?: string;
  productCount?: number;
}

export interface StoreSummary {
  id: string;
  name: string;
  slug: string;
  verified: boolean;
  rating?: number;
  responseTime?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description?: string;
  price: MoneyValue;
  compareAtPrice?: MoneyValue | null;
  currency?: string;
  image?: string;
  images?: string[];
  category?: Category | string;
  store?: StoreSummary;
  rating?: number;
  reviewCount?: number;
  stock?: number;
  soldPercent?: number;
  badge?: string;
  location?: string;
  variantId?: string;
  shippingFee?: MoneyValue;
  primary?: string;
  secondary?: string;
  date?: string;
}

export interface CartItem {
  id: string;
  quantity: number;
  product: Product;
  variantId?: string;
}

export interface Cart {
  id?: string;
  items: CartItem[];
  itemCount: number;
  subtotal: MoneyValue;
}

export interface Address {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  isDefault?: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  total: MoneyValue;
  itemCount: number;
  thumbnail?: string;
  storeName?: string;
}

export interface Metric {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface ActivityRow {
  id: string;
  primary: string;
  secondary: string;
  status: string;
  value?: string;
  date?: string;
  name?: string;
  orderNumber?: string;
  title?: string;
  email?: string;
  sku?: string;
  quantity?: number | string;
  total?: number | string;
  price?: number | string;
  type?: string;
  customer?: string;
  role?: string;
}

export interface DashboardData {
  metrics: Metric[];
  rows: ActivityRow[];
  chart?: number[];
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface PageResult<T> {
  items: T[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

export interface Viewer {
  id: string;
  email: string;
  displayName: string;
  platformRoles: string[];
  storeMemberships: Array<{
    storeId: string;
    storeName: string;
    permissions: string[];
  }>;
}
