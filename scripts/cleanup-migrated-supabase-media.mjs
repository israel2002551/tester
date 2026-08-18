import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const envFile = resolve(process.cwd(), '.env.cloudinary-migration');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[2].startsWith('#') && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!supabaseUrl || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const tables = ['products', 'upcoming_products'];
const candidatePrefixes = ['imgs/', 'vids/', 'upcoming/images/', 'upcoming/videos/'];

function values(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try { return Array.isArray(JSON.parse(value)) ? JSON.parse(value) : [value]; } catch { return [value]; }
}

function storageReference(url) {
  if (typeof url !== 'string') return null;
  const marker = '/storage/v1/object/public/';
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const parts = url.slice(index + marker.length).split('/');
  const bucket = parts.shift();
  return bucket && parts.length ? `${bucket}/${parts.join('/')}` : null;
}

async function getRows(table, offset) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=image_url,images,video_url,videos&limit=1000&offset=${offset}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`Could not read ${table}: ${await response.text()}`);
  return response.json();
}

async function referencedStorageObjects() {
  const references = new Set();
  for (const table of tables) {
    for (let offset = 0; ; offset += 1000) {
      const rows = await getRows(table, offset);
      for (const row of rows) {
        for (const value of [row.image_url, row.video_url, ...values(row.images), ...values(row.videos)]) {
          const reference = storageReference(value);
          if (reference) references.add(reference);
        }
      }
      if (rows.length < 1000) break;
    }
  }
  return references;
}

async function listFolder(bucket, prefix, offset) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!response.ok) throw new Error(`Could not list ${bucket}/${prefix}: ${await response.text()}`);
  return response.json();
}

async function listFilesRecursively(bucket, prefix) {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const objects = await listFolder(bucket, prefix, offset);
    for (const object of objects) {
      const name = String(object.name || '');
      if (!name) continue;
      const fullName = name.startsWith(prefix) ? name : `${prefix}${name}`;
      if (object.id) files.push(fullName);
      else files.push(...await listFilesRecursively(bucket, `${fullName.replace(/\/$/, '')}/`));
    }
    if (objects.length < 1000) break;
  }
  return files;
}

async function deleteObject(bucket, name) {
  const path = name.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`Could not delete ${bucket}/${name}: ${await response.text()}`);
}

const references = await referencedStorageObjects();
const candidates = [];
for (const bucket of ['products', 'uploads']) {
  for (const prefix of candidatePrefixes) {
    for (const name of await listFilesRecursively(bucket, prefix)) {
      if (!references.has(`${bucket}/${name}`)) {
        candidates.push({ bucket, name });
      }
    }
  }
}

console.log(`${APPLY ? 'Deleting' : 'Would delete'} ${candidates.length} unreferenced migrated-media file(s).`);
for (const item of candidates) {
  if (APPLY) await deleteObject(item.bucket, item.name);
  console.log(`${APPLY ? 'Deleted' : 'Would delete'} ${item.bucket}/${item.name}`);
}
if (!APPLY) console.log('Dry run only: no files were deleted.');
