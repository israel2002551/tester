import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(here, '..', '..');
export const DEFAULT_WORK_DIR = path.join(REPOSITORY_ROOT, 'migration-data');

export const SOURCE_TABLES = Object.freeze([
  { name: 'profiles', required: true, target: ['User', 'AuthIdentity', 'UserProfile', 'Store', 'StoreMembership', 'LedgerAccount'] },
  { name: 'products', required: true, target: ['Product', 'ProductMedia'] },
  { name: 'safe_hubs', required: true, target: ['FulfilmentHub'] },
  { name: 'service_gigs', required: false, target: ['ServiceListing'] },
  { name: 'service_bookings', required: false, target: ['ServiceBooking'] },
  { name: 'orders', required: true, target: ['Order', 'StoreOrder', 'OrderItem', 'SourcingRequest'] },
  { name: 'disputes', required: false, target: ['Dispute', 'LegacyReviewQueue'] },
  { name: 'reviews', required: false, target: ['Review', 'LegacyReviewQueue'] },
  { name: 'withdrawals', required: false, target: ['PayoutRequest', 'LegacyReviewQueue'] },
  { name: 'referrals', required: false, target: ['ReferralCode', 'ReferralVisit', 'AuditLog'] },
  { name: 'broadcasts', required: false, target: ['BroadcastCampaign'] },
  { name: 'payment_receipts', required: false, target: ['Payment', 'PaymentAttempt', 'LegacyReviewQueue'] },
  { name: 'commission_receipts', required: false, target: ['AuditLog', 'MediaAsset'] },
  { name: 'kyc_verifications', required: false, target: ['KycSubmission', 'KycDocument', 'MediaAsset'] },
  { name: 'advertisements', required: false, target: ['AdCampaign'] },
  { name: 'affiliate_earnings', required: false, target: ['LegacyReviewQueue'] },
  { name: 'wishlists', required: false, target: ['Wishlist', 'WishlistItem'] },
  { name: 'coupons', required: false, target: ['Coupon'] },
  { name: 'flash_sales', required: false, target: ['Product', 'LegacyReviewQueue'] },
  { name: 'messages', required: false, target: ['Conversation', 'Message'] },
  { name: 'service_reviews', required: false, target: ['Review', 'LegacyReviewQueue'] },
  { name: 'order_tracking', required: false, target: ['OrderStatusEvent'] },
  { name: 'referral_clicks', required: false, target: ['ReferralVisit'] },
  { name: 'coupon_redemptions', required: false, target: ['CouponRedemption'] },
  { name: 'dropship_supplier_connections', required: false, target: ['SupplierConnection'] },
  { name: 'dropship_catalog', required: false, target: ['SupplierProduct'] },
  { name: 'dropship_imports', required: false, target: ['Product', 'SupplierProduct', 'LegacyReviewQueue'] },
  { name: 'seller_analytics_events', required: true, target: ['LegacyArchive', 'Store.metadata'] },
  { name: 'wallet_transactions', required: false, target: ['LedgerEntry'] },
  { name: 'landing_media', required: false, target: ['MediaAsset', 'SiteSetting'] },
  { name: 'push_subscriptions', required: false, target: ['PushSubscription'] },
  { name: 'upcoming_products', required: false, target: ['Product', 'SiteSetting'] },
  { name: 'seller_staff_permissions', required: false, target: ['StoreMembership', 'StoreMembershipPermission'] },
]);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function selectedTables(value) {
  if (!value || value === 'all') return [...SOURCE_TABLES];
  const names = new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean));
  const known = new Map(SOURCE_TABLES.map((table) => [table.name, table]));
  const unknown = [...names].filter((name) => !known.has(name));
  if (unknown.length) throw new Error(`Unknown table(s): ${unknown.join(', ')}`);
  return [...names].map((name) => known.get(name));
}

export function resolveWorkPath(value, fallbackParts = []) {
  const resolved = path.resolve(value || path.join(DEFAULT_WORK_DIR, ...fallbackParts));
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || resolved === REPOSITORY_ROOT) {
    throw new Error(`Refusing broad migration path: ${resolved}`);
  }
  return resolved;
}

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw new Error(`Invalid JSON in ${file}: ${error.message}`);
  }
}

export async function writeJson(file, value) {
  await ensureDirectory(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function appendNdjson(file, rows) {
  if (!rows.length) return;
  await ensureDirectory(path.dirname(file));
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await appendFile(file, payload, { encoding: 'utf8', mode: 0o600 });
}

export async function* readNdjson(file) {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield { value: JSON.parse(line), lineNumber };
    } catch (error) {
      throw new Error(`${file}:${lineNumber}: invalid NDJSON (${error.message})`);
    }
  }
}

export async function countNdjson(file) {
  let count = 0;
  for await (const _ of readNdjson(file)) count += 1;
  return count;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export function sha256Value(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function stableKey(...values) {
  return sha256Value(values.map((value) => String(value ?? '')).join('\u001f')).slice(0, 32);
}

export function stableUuid(...values) {
  const hex = sha256Value(values.map((value) => String(value ?? '')).join('\u001f')).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

export function uuidOrStable(value, ...fallback) {
  const candidate = String(value || '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)
    ? candidate
    : stableUuid(...fallback, candidate);
}

export async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function sourceEnvironment() {
  const url = String(process.env.SOURCE_SUPABASE_URL || '').replace(/\/$/, '');
  const broadKey = process.env.ALLOW_BROAD_SOURCE_CREDENTIAL === 'true'
    ? (process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || process.env.SOURCE_SUPABASE_ANON_KEY || '')
    : '';
  const key = process.env.SOURCE_SUPABASE_READ_ONLY_KEY || broadKey;
  if (!url || !key) {
    throw new Error('Set SOURCE_SUPABASE_URL and SOURCE_SUPABASE_READ_ONLY_KEY. Broad service/anon credentials require the explicit ALLOW_BROAD_SOURCE_CREDENTIAL=true override.');
  }
  return { url, key };
}

export async function readonlyFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    throw new Error(`Migration network guard rejected non-read method: ${method}`);
  }
  const response = await fetch(url, { ...options, method, redirect: 'follow' });
  return response;
}

export async function readOnlyStorageList({ url, key, bucket, prefix = '', limit = 1000, offset = 0 }) {
  if (!bucket || /[\/\\]/.test(bucket)) throw new Error(`Unsafe storage bucket: ${bucket}`);
  const endpoint = new URL(`${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`);
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: supabaseHeaders(key, { 'content-type': 'application/json' }),
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Storage list ${bucket}: HTTP ${response.status}: ${body?.message || body?.error || response.statusText}`);
  if (!Array.isArray(body)) throw new Error(`Storage list ${bucket}: expected an array response`);
  return body;
}

export function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    ...extra,
  };
}

export async function fetchTablePage({ url, key, table, offset, limit, order = 'id.asc' }) {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  endpoint.searchParams.set('select', '*');
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('offset', String(offset));
  if (order) endpoint.searchParams.set('order', order);
  let response = await readonlyFetch(endpoint, { headers: supabaseHeaders(key) });
  if (!response.ok && order && [400, 404].includes(response.status)) {
    endpoint.searchParams.delete('order');
    response = await readonlyFetch(endpoint, { headers: supabaseHeaders(key) });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || body?.error || response.statusText;
    const error = new Error(`${table}: HTTP ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(body)) throw new Error(`${table}: expected an array response`);
  return body;
}

export function publicSourceDescriptor(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''}`;
  } catch {
    return 'invalid-source-url';
  }
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return value == null ? [] : [value];
}

export function textOrNull(value, maxLength = 10_000) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

export function decimalOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(value) : null;
}

export function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function migrationEnvelope(table, row, targetEntity, data) {
  const legacyId = textOrNull(row.id) || stableKey(table, JSON.stringify(row));
  return {
    migrationVersion: 1,
    targetEntity,
    source: {
      system: 'legacy-supabase',
      table,
      id: legacyId,
      recordSha256: sha256Value(JSON.stringify(row)),
    },
    data,
  };
}

export function printPlan(title, details) {
  console.log(JSON.stringify({ dryRun: true, operation: title, ...details }, null, 2));
}
