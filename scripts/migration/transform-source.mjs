#!/usr/bin/env node
import path from 'node:path';
import {
  appendNdjson,
  fileExists,
  parseArgs,
  printPlan,
  readJson,
  readNdjson,
  resolveWorkPath,
  selectedTables,
  sha256File,
  writeJson,
} from './common.mjs';
import { transformSourceRow } from './transforms.mjs';

const args = parseArgs();
if (args.help) {
  console.log(`Usage: node scripts/migration/transform-source.mjs [options]

Options:
  --tables profiles,products  Limit tables (default: all known tables)
  --in PATH                  Source export directory
  --out PATH                 Transformed output directory
  --execute                  Write normalized NDJSON and migration manifest

The operation is local-only and resumable per completed source table. It never writes to either database.`);
  process.exit(0);
}

const tables = selectedTables(args.tables);
const inputDir = resolveWorkPath(args.in, ['source']);
const outputDir = resolveWorkPath(args.out, ['transformed']);
const stateFile = path.join(outputDir, 'transform-state.json');
const manifestFile = path.join(outputDir, 'migration-manifest.ndjson');

if (!args.execute) {
  printPlan('transform-source', { inputDirectory: inputDir, outputDirectory: outputDir, tables: tables.map((item) => item.name), databaseWrites: false });
  process.exit(0);
}

const state = await readJson(stateFile, { formatVersion: 1, tables: {}, updatedAt: null });
for (const table of tables) {
  const input = path.join(inputDir, 'tables', `${table.name}.ndjson`);
  if (!(await fileExists(input))) {
    if (table.required) throw new Error(`Required source export is missing: ${input}`);
    console.warn(`${table.name}: source export unavailable; skipped`);
    continue;
  }
  const checksum = await sha256File(input);
  if (state.tables[table.name]?.status === 'complete' && state.tables[table.name]?.sourceSha256 === checksum) {
    console.log(`${table.name}: already transformed`);
    continue;
  }
  if (state.tables[table.name]?.status === 'complete') {
    throw new Error(`${table.name}: source changed after transformation. Use a new output directory for the new snapshot.`);
  }
  const tableState = state.tables[table.name] || { status: 'transforming', sourceRows: 0, targetRecords: 0, sourceSha256: checksum, entities: [] };
  if (tableState.sourceSha256 !== checksum) throw new Error(`${table.name}: partial state belongs to a different source checksum.`);
  state.tables[table.name] = tableState;
  const entityFiles = new Map(tableState.entities.map((entity) => [entity, path.join(outputDir, 'entities', `${entity}.ndjson`)]));
  let visitedRows = 0;
  let rows = Number(tableState.sourceRows || 0);
  let records = Number(tableState.targetRecords || 0);
  for await (const { value: row } of readNdjson(input)) {
    visitedRows += 1;
    if (visitedRows <= tableState.sourceRows) continue;
    const transformed = transformSourceRow(table.name, row);
    for (const envelope of transformed) {
      const target = envelope.targetEntity;
      const targetFile = path.join(outputDir, 'entities', `${target}.ndjson`);
      await appendNdjson(targetFile, [envelope]);
      entityFiles.set(target, targetFile);
      await appendNdjson(manifestFile, [{
        sourceTable: table.name,
        sourceId: envelope.source.id,
        targetTable: target,
        targetId: envelope.data.id || envelope.data.userId || envelope.data.variantId || null,
        status: target === 'LegacyReviewQueue' ? 'needs_review' : 'transformed',
        warnings: envelope.data.warning ? [envelope.data.warning] : [],
        timestamp: new Date().toISOString(),
      }]);
      records += 1;
    }
    rows += 1;
    tableState.sourceRows = rows;
    tableState.targetRecords = records;
    tableState.entities = [...entityFiles.keys()].sort();
    tableState.updatedAt = new Date().toISOString();
    state.updatedAt = tableState.updatedAt;
    await writeJson(stateFile, state);
  }
  state.tables[table.name] = {
    status: 'complete', sourceRows: rows, targetRecords: records, sourceSha256: checksum,
    entities: [...entityFiles.keys()].sort(), completedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  await writeJson(stateFile, state);
  console.log(`${table.name}: ${rows} source rows -> ${records} normalized records`);
}
console.log(`Migration manifest: ${manifestFile}`);
