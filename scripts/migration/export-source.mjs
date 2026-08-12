#!/usr/bin/env node
import path from 'node:path';
import {
  appendNdjson,
  countNdjson,
  fetchTablePage,
  fileExists,
  parseArgs,
  printPlan,
  publicSourceDescriptor,
  readJson,
  resolveWorkPath,
  selectedTables,
  sha256File,
  sourceEnvironment,
  writeJson,
} from './common.mjs';

const args = parseArgs();
if (args.help) {
  console.log(`Usage: node scripts/migration/export-source.mjs [options]

Options:
  --tables profiles,products   Limit tables (default: all known tables)
  --out PATH                  Export directory
  --page-size N               Rows per GET request (default: 500, max: 1000)
  --execute                   Perform the read-only export
  --strict                    Fail on unavailable optional tables

Exports are NDJSON. export-state.json records the completed offset after every page.
Re-running the same command resumes partial tables and verifies completed checksums.`);
  process.exit(0);
}

const tables = selectedTables(args.tables);
const outDir = resolveWorkPath(args.out, ['source']);
const pageSize = Math.min(1000, Math.max(1, Number(args.pageSize || 500)));
const stateFile = path.join(outDir, 'export-state.json');
const manifestFile = path.join(outDir, 'export-manifest.json');

if (!args.execute) {
  printPlan('export-source', {
    tables: tables.map(({ name, required }) => ({ name, required })),
    outputDirectory: outDir,
    pageSize,
    resumeState: stateFile,
    networkMethods: ['GET'],
  });
  process.exit(0);
}

const source = sourceEnvironment();
const sourceDescriptor = publicSourceDescriptor(source.url);
const state = await readJson(stateFile, {
  formatVersion: 1,
  source: sourceDescriptor,
  startedAt: new Date().toISOString(),
  updatedAt: null,
  tables: {},
});
if (state.source !== sourceDescriptor) {
  throw new Error(`Resume state belongs to ${state.source}; refusing to mix it with ${sourceDescriptor}.`);
}

for (const table of tables) {
  const targetFile = path.join(outDir, 'tables', `${table.name}.ndjson`);
  const tableState = state.tables[table.name] || {
    status: 'pending',
    offset: 0,
    rows: 0,
    file: path.relative(outDir, targetFile).replaceAll('\\', '/'),
  };

  if (tableState.status === 'complete') {
    if (!(await fileExists(targetFile))) throw new Error(`${table.name}: completed state exists but export file is missing.`);
    const checksum = await sha256File(targetFile);
    if (checksum !== tableState.sha256) throw new Error(`${table.name}: completed export checksum mismatch.`);
    console.log(`${table.name}: already complete (${tableState.rows} rows)`);
    continue;
  }

  if (await fileExists(targetFile)) {
    const lines = await countNdjson(targetFile);
    if (lines !== Number(tableState.offset || 0)) {
      throw new Error(`${table.name}: resume offset ${tableState.offset || 0} does not match ${lines} exported rows.`);
    }
  } else if (Number(tableState.offset || 0) !== 0) {
    throw new Error(`${table.name}: partial state exists but its NDJSON file is missing.`);
  }

  state.tables[table.name] = tableState;
  tableState.status = 'exporting';
  tableState.required = table.required;
  state.updatedAt = new Date().toISOString();
  await writeJson(stateFile, state);

  try {
    while (true) {
      const rows = await fetchTablePage({
        ...source,
        table: table.name,
        offset: tableState.offset,
        limit: pageSize,
      });
      await appendNdjson(targetFile, rows);
      tableState.offset += rows.length;
      tableState.rows = tableState.offset;
      tableState.lastPageAt = new Date().toISOString();
      state.updatedAt = tableState.lastPageAt;
      await writeJson(stateFile, state);
      console.log(`${table.name}: ${tableState.rows} rows exported`);
      if (rows.length < pageSize) break;
    }
    tableState.status = 'complete';
    tableState.completedAt = new Date().toISOString();
    tableState.sha256 = await sha256File(targetFile);
  } catch (error) {
    tableState.status = 'unavailable';
    tableState.error = error.message;
    tableState.completedAt = new Date().toISOString();
    if (table.required || args.strict) {
      await writeJson(stateFile, state);
      throw error;
    }
    console.warn(`${table.name}: skipped optional table (${error.message})`);
  }
  state.updatedAt = new Date().toISOString();
  await writeJson(stateFile, state);
}

const manifest = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  source: sourceDescriptor,
  snapshotConsistency: 'best-effort; source writes were not paused',
  tables: state.tables,
};
await writeJson(manifestFile, manifest);
console.log(`Export manifest: ${manifestFile}`);
