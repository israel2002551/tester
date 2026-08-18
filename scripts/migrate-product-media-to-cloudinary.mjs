import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 100;
const envFile = resolve(process.cwd(), '.env.cloudinary-migration');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[2].startsWith('#') && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}. Add it to this terminal session before running the migration.`);
}

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudApiKey = process.env.CLOUDINARY_API_KEY;
const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;
const storageOrigin = `${supabaseUrl}/storage/v1/object/`;
const mediaCache = new Map();
const targets = [
  { table: 'products', folder: 'products' },
  { table: 'upcoming_products', folder: 'upcoming-products' },
];

function sha1(value) {
  return createHash('sha1').update(value).digest('hex');
}

function asUrlArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function isSupabaseStorageUrl(value) {
  return typeof value === 'string' && value.startsWith(storageOrigin);
}

function isSameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function getRows(table, offset) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id,image_url,images,video_url,videos&order=id.asc&limit=${BATCH_SIZE}&offset=${offset}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`Could not read ${table}: ${await response.text()}`);
  return response.json();
}

async function uploadRemoteMedia(sourceUrl, type, collection, rowId) {
  const cacheKey = `${collection}:${type}:${sourceUrl}`;
  if (mediaCache.has(cacheKey)) return mediaCache.get(cacheKey);

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `buysell/migrated/${collection}/${rowId}`;
  const publicId = `${type}-${sha1(sourceUrl).slice(0, 20)}`;
  const signature = sha1(`folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}${cloudApiSecret}`);
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${type}/upload`;
  const createForm = (file) => {
    const form = new FormData();
    form.set('file', file);
    form.set('api_key', cloudApiKey);
    form.set('timestamp', String(timestamp));
    form.set('folder', folder);
    form.set('public_id', publicId);
    form.set('overwrite', 'true');
    form.set('signature', signature);
    return form;
  };

  let response = await fetch(endpoint, { method: 'POST', body: createForm(sourceUrl) });
  let data = await response.json().catch(() => ({}));
  if (!response.ok || !data.secure_url) {
    // Some public Storage video URLs cannot be fetched by Cloudinary's servers.
    // Fall back to downloading the original once and streaming it to Cloudinary.
    const original = await fetch(sourceUrl);
    if (!original.ok) throw new Error(data?.error?.message || `Could not download ${sourceUrl}`);
    const blob = await original.blob();
    response = await fetch(endpoint, { method: 'POST', body: createForm(blob) });
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok || !data.secure_url) throw new Error(data?.error?.message || `Cloudinary ${type} upload failed for ${sourceUrl}`);
  const result = { url: data.secure_url, publicId: data.public_id };
  mediaCache.set(cacheKey, result);
  return result;
}

async function migrateValue(value, type, collection, rowId) {
  if (!isSupabaseStorageUrl(value)) return value || '';
  if (!APPLY) return `cloudinary://pending/${type}/${sha1(value).slice(0, 20)}`;
  const result = await uploadRemoteMedia(value, type, collection, rowId);
  return result.url;
}

async function updateRow(table, id, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not update ${table} row ${id}: ${await response.text()}`);
}

async function migrateRow(row, target) {
  const oldImages = asUrlArray(row.images);
  const oldVideos = asUrlArray(row.videos);
  const imageUrl = await migrateValue(row.image_url, 'image', target.folder, row.id);
  const videoUrl = await migrateValue(row.video_url, 'video', target.folder, row.id);
  const images = [];
  for (const url of oldImages) images.push(await migrateValue(url, 'image', target.folder, row.id));
  const videos = [];
  for (const url of oldVideos) videos.push(await migrateValue(url, 'video', target.folder, row.id));

  const payload = {};
  if (imageUrl !== (row.image_url || '')) payload.image_url = imageUrl;
  if (videoUrl !== (row.video_url || '')) payload.video_url = videoUrl;
  if (!isSameList(images, oldImages)) payload.images = images;
  if (!isSameList(videos, oldVideos)) payload.videos = videos;
  if (!Object.keys(payload).length) return false;

  if (APPLY) await updateRow(target.table, row.id, payload);
  console.log(`${APPLY ? 'Updated' : 'Would update'} ${target.table}/${row.id}`, payload);
  return true;
}

let scanned = 0;
let changed = 0;
const failures = [];
for (const target of targets) {
  let offset = 0;
  while (true) {
    const rows = await getRows(target.table, offset);
    if (!rows.length) break;
    for (const row of rows) {
      scanned += 1;
      try {
        if (await migrateRow(row, target)) changed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ table: target.table, id: row.id, message });
        console.error(`Failed ${target.table}/${row.id}: ${message}`);
      }
    }
    offset += rows.length;
  }
}

console.log(`${APPLY ? 'Migration complete' : 'Dry run complete'}: ${changed} product rows ${APPLY ? 'updated' : 'would be updated'}, ${scanned} scanned.`);
if (!APPLY) console.log('No Cloudinary uploads or database updates were made. Re-run with --apply after reviewing this output.');
if (failures.length) {
  console.error(`${failures.length} product row(s) could not be migrated.`, failures);
  process.exitCode = 1;
}
