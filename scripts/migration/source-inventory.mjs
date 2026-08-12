#!/usr/bin/env node
import path from 'node:path';
import {
  parseArgs,
  printPlan,
  publicSourceDescriptor,
  readonlyFetch,
  resolveWorkPath,
  selectedTables,
  sourceEnvironment,
  supabaseHeaders,
  writeJson,
} from './common.mjs';

const args = parseArgs();

if (args.help) {
  console.log(`Usage: node scripts/migration/source-inventory.mjs [options]

Options:
  --tables profiles,products   Limit the configured table set (default: all)
  --out PATH                  Inventory JSON path
  --execute                   Perform read-only Supabase requests and write output
  --strict                    Fail when an optional table is unavailable

Without --execute the command only prints its plan. Network methods are restricted to GET/HEAD.`);
  process.exit(0);
}

const tables = selectedTables(args.tables);
const outFile = path.resolve(args.out || resolveWorkPath(null, ['inventory', 'source-inventory.json']));

if (!args.execute) {
  printPlan('source-inventory', {
    tables: tables.map(({ name, required }) => ({ name, required })),
    output: outFile,
    networkMethods: ['GET', 'HEAD'],
  });
  process.exit(0);
}

const source = sourceEnvironment();
const inventory = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  source: publicSourceDescriptor(source.url),
  readOnly: true,
  tables: {},
  buckets: [],
  warnings: [],
};

for (const table of tables) {
  const endpoint = new URL(`${source.url}/rest/v1/${table.name}`);
  endpoint.searchParams.set('select', '*');
  endpoint.searchParams.set('limit', '1');
  const response = await readonlyFetch(endpoint, {
    headers: supabaseHeaders(source.key, { Prefer: 'count=exact', Range: '0-0' }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const result = {
      available: false,
      required: table.required,
      status: response.status,
      error: body?.message || body?.error || response.statusText,
    };
    inventory.tables[table.name] = result;
    inventory.warnings.push(`${table.name}: ${result.error}`);
    if (table.required || args.strict) throw new Error(`${table.name}: ${result.error}`);
    continue;
  }
  const range = response.headers.get('content-range') || '';
  const totalToken = range.split('/')[1];
  inventory.tables[table.name] = {
    available: true,
    required: table.required,
    rowCount: /^\d+$/.test(totalToken || '') ? Number(totalToken) : null,
    columnsObserved: Object.keys(body?.[0] || {}).sort(),
    targetHints: table.target,
  };
}

const bucketResponse = await readonlyFetch(`${source.url}/storage/v1/bucket`, {
  headers: supabaseHeaders(source.key),
});
if (bucketResponse.ok) {
  const buckets = await bucketResponse.json().catch(() => []);
  inventory.buckets = (Array.isArray(buckets) ? buckets : []).map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
  }));
} else {
  inventory.warnings.push(`Storage bucket inventory unavailable (HTTP ${bucketResponse.status}).`);
}

await writeJson(outFile, inventory);
console.log(`Wrote read-only source inventory: ${outFile}`);
