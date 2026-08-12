#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgs,
  printPlan,
  publicSourceDescriptor,
  readJson,
  readOnlyStorageList,
  resolveWorkPath,
  sourceEnvironment,
  writeJson,
} from './common.mjs';

const args = parseArgs();
const inventoryFile = path.resolve(args.inventory || resolveWorkPath(null, ['inventory', 'source-inventory.json']));
const outFile = path.resolve(args.out || resolveWorkPath(null, ['inventory', 'media-inventory.json']));
const pageSize = Math.min(1000, Math.max(1, Number(args.pageSize || 1000)));

if (args.help) {
  console.log(`Usage: node scripts/migration/inventory-media.mjs --execute [--inventory PATH] [--out PATH]\n\nLists Storage objects without downloading or changing them. The Storage list endpoint is a read operation even though its protocol method is POST.`);
  process.exit(0);
}
if (!args.execute) {
  printPlan('inventory-media', { sourceInventory: inventoryFile, output: outFile, mutatesSource: false, downloadsObjects: false });
  process.exit(0);
}

const source = sourceEnvironment();
const inventory = await readJson(inventoryFile);
if (!inventory) throw new Error(`Run source-inventory first: ${inventoryFile}`);
const result = { formatVersion: 1, source: publicSourceDescriptor(source.url), generatedAt: new Date().toISOString(), buckets: {}, totalObjects: 0, totalBytes: 0 };
for (const bucket of inventory.buckets || []) {
  const objects = [];
  const pendingPrefixes = [''];
  const visitedPrefixes = new Set();
  while (pendingPrefixes.length) {
    const currentPrefix = pendingPrefixes.shift();
    if (visitedPrefixes.has(currentPrefix)) continue;
    visitedPrefixes.add(currentPrefix);
    let offset = 0;
    while (true) {
      const page = await readOnlyStorageList({ ...source, bucket: bucket.id || bucket.name, prefix: currentPrefix, limit: pageSize, offset });
      for (const object of page) {
        const fullName = currentPrefix ? `${currentPrefix}/${object.name}` : object.name;
        if (!object.id && !object.metadata) {
          pendingPrefixes.push(fullName);
          continue;
        }
        objects.push({
          name: fullName, id: object.id || null, bytes: Number(object.metadata?.size || 0),
          mimeType: object.metadata?.mimetype || null, createdAt: object.created_at || null, updatedAt: object.updated_at || null,
        });
      }
      offset += page.length;
      if (page.length < pageSize) break;
    }
  }
  const bytes = objects.reduce((sum, object) => sum + object.bytes, 0);
  result.buckets[bucket.id || bucket.name] = { public: Boolean(bucket.public), objects, count: objects.length, bytes };
  result.totalObjects += objects.length;
  result.totalBytes += bytes;
  console.log(`${bucket.id || bucket.name}: ${objects.length} objects`);
}
await writeJson(outFile, result);
console.log(`Media inventory: ${outFile}`);
