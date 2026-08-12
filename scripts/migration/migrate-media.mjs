#!/usr/bin/env node
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  parseArgs,
  printPlan,
  readJson,
  readonlyFetch,
  resolveWorkPath,
  sourceEnvironment,
  supabaseHeaders,
  writeJson,
} from './common.mjs';

const args = parseArgs();
const inventoryFile = path.resolve(args.inventory || resolveWorkPath(null, ['inventory', 'media-inventory.json']));
const stateFile = path.resolve(args.state || resolveWorkPath(null, ['media', 'copy-state.json']));
const prefix = String(args.prefix || 'legacy').replace(/^\/+|\/+$/g, '');
const maxBytes = Math.max(1, Number(args.maxBytes || 100 * 1024 * 1024));

if (args.help) {
  console.log(`Usage: node scripts/migration/migrate-media.mjs --execute --confirm COPY_MEDIA_TO_TARGET [options]

Required target environment: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
The source is read-only. Target uploads are resumable through copy-state.json; no source objects are removed.`);
  process.exit(0);
}
if (!args.execute) {
  printPlan('migrate-media', { inventory: inventoryFile, targetPrefix: prefix, state: stateFile, sourceMutations: false, targetWrites: true, maxObjectBytes: maxBytes });
  process.exit(0);
}
if (args.confirm !== 'COPY_MEDIA_TO_TARGET') throw new Error('Refusing target writes without --confirm COPY_MEDIA_TO_TARGET.');

const required = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required.`);
const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
const source = sourceEnvironment();
const inventory = await readJson(inventoryFile);
if (!inventory) throw new Error(`Media inventory not found: ${inventoryFile}`);
const state = await readJson(stateFile, { formatVersion: 1, startedAt: new Date().toISOString(), objects: {}, copied: 0, failed: 0 });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});

for (const [bucket, details] of Object.entries(inventory.buckets || {})) {
  for (const object of details.objects || []) {
    const sourceObject = `${bucket}/${object.name}`;
    if (state.objects[sourceObject]?.status === 'copied') continue;
    if (object.bytes > maxBytes) {
      state.objects[sourceObject] = { status: 'failed', error: `Object exceeds configured ${maxBytes}-byte buffer ceiling.`, updatedAt: new Date().toISOString() };
      state.failed += 1;
      await writeJson(stateFile, state);
      continue;
    }
    const encodedPath = object.name.split('/').map(encodeURIComponent).join('/');
    const route = details.public ? 'public' : 'authenticated';
    const sourceUrl = `${source.url}/storage/v1/object/${route}/${encodeURIComponent(bucket)}/${encodedPath}`;
    const targetKey = `${prefix}/${encodeURIComponent(bucket)}/${object.name}`;
    try {
      const response = await readonlyFetch(sourceUrl, { headers: supabaseHeaders(source.key) });
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > maxBytes) throw new Error(`Downloaded object exceeds configured ${maxBytes}-byte buffer ceiling.`);
      const sha256 = createHash('sha256').update(body).digest('hex');
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: targetKey,
        Body: body,
        ContentType: object.mimeType || 'application/octet-stream',
        ContentLength: body.byteLength,
        ServerSideEncryption: 'AES256',
        Metadata: { sourcebucket: bucket.slice(0, 100), sourcesha256: sha256 },
      }));
      state.objects[sourceObject] = { status: 'copied', targetKey, bytes: body.byteLength, sha256, access: details.public ? 'PUBLIC' : 'PRIVATE', updatedAt: new Date().toISOString() };
      state.copied += 1;
    } catch (error) {
      state.objects[sourceObject] = { status: 'failed', targetKey, error: error.message, updatedAt: new Date().toISOString() };
      state.failed += 1;
    }
    state.updatedAt = new Date().toISOString();
    await writeJson(stateFile, state);
  }
}
console.log(`Media copy complete: ${state.copied} copied, ${state.failed} failed. Source was not modified.`);
