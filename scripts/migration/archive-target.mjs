#!/usr/bin/env node
import path from 'node:path';
import {
  fileExists,
  parseArgs,
  printPlan,
  readJson,
  readNdjson,
  resolveWorkPath,
  selectedTables,
  stableUuid,
} from './common.mjs';

const args = parseArgs();
const inputDir = resolveWorkPath(args.in, ['source']);
const manifestFile = path.join(inputDir, 'export-manifest.json');
const confirmed = args.execute && args.confirm === 'ARCHIVE_SOURCE_TO_TARGET';

if (args.help) {
  console.log(`Usage: node scripts/migration/archive-target.mjs --execute --confirm ARCHIVE_SOURCE_TO_TARGET [options]

Options:
  --in PATH       Source export directory (default: migration-data/source)
  --tables LIST   Limit tables (default: all 33 source public tables)
  --batch-id UUID Override the deterministic batch id

The command only inserts or updates the private legacy_supabase archive. It never
deletes source or target records. Run Prisma migrations before using it.`);
  process.exit(0);
}

if (!confirmed) {
  printPlan('archive-target', {
    inputDirectory: inputDir,
    sourceManifest: manifestFile,
    targetSchema: 'legacy_supabase',
    targetWrites: true,
    destructiveStatements: false,
    requiredConfirmation: 'ARCHIVE_SOURCE_TO_TARGET',
  });
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const manifest = await readJson(manifestFile);
if (!manifest) throw new Error(`Export manifest not found: ${manifestFile}`);

const batchId = args.batchId || stableUuid('legacy-supabase-archive', manifest.source, manifest.generatedAt);
const tables = selectedTables(args.tables);
const { Client } = await import('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'buysell-legacy-archive' });
await client.connect();

try {
  const expectedPublicRows = tables.reduce((sum, table) => sum + Number(manifest.tables?.[table.name]?.rows || 0), 0);
  await client.query(
    `INSERT INTO legacy_supabase.import_batch
       (id, source_project_ref, source_snapshot_at, expected_public_rows, metadata)
     VALUES ($1::uuid, $2, $3::timestamptz, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       expected_public_rows=excluded.expected_public_rows,
       metadata=legacy_supabase.import_batch.metadata||excluded.metadata`,
    [batchId, manifest.source, manifest.generatedAt, expectedPublicRows, JSON.stringify({ exporterFormatVersion: manifest.formatVersion })],
  );

  for (const table of tables) {
    const file = path.join(inputDir, 'tables', `${table.name}.ndjson`);
    if (!(await fileExists(file))) {
      if (table.required) throw new Error(`Required export is missing: ${file}`);
      continue;
    }

    const rows = [];
    for await (const { value } of readNdjson(file)) rows.push(value);
    const expected = Number(manifest.tables?.[table.name]?.rows ?? rows.length);
    if (rows.length !== expected) throw new Error(`${table.name}: manifest=${expected}, file=${rows.length}`);

    await client.query('BEGIN');
    try {
      await client.query(
        `WITH payload AS (
           SELECT value AS row_data, ordinality::bigint AS source_ordinal
           FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY
         )
         INSERT INTO legacy_supabase.raw_row
           (batch_id, source_schema, source_table, source_ordinal, source_row_key, row_data)
         SELECT $2::uuid, 'public', $3, source_ordinal,
                COALESCE(row_data->>'id', row_data->>'user_id', row_data->>'email', source_ordinal::text),
                row_data
         FROM payload
         ON CONFLICT (batch_id, source_schema, source_table, source_ordinal)
         DO UPDATE SET source_row_key=excluded.source_row_key, row_data=excluded.row_data`,
        [JSON.stringify(rows), batchId, table.name],
      );
      await client.query(
        `INSERT INTO legacy_supabase.table_manifest
           (batch_id, source_schema, source_table, expected_rows, imported_rows, checksum)
         SELECT $1::uuid, 'public', $2, $3, count(*),
                md5(COALESCE(string_agg(source_hash, '' ORDER BY source_ordinal), ''))
         FROM legacy_supabase.raw_row
         WHERE batch_id=$1::uuid AND source_schema='public' AND source_table=$2
         ON CONFLICT (batch_id, source_schema, source_table)
         DO UPDATE SET expected_rows=excluded.expected_rows, imported_rows=excluded.imported_rows,
                       checksum=excluded.checksum, imported_at=now()`,
        [batchId, table.name, expected],
      );
      await client.query('COMMIT');
      console.log(`${table.name}: archived ${rows.length} rows`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  await client.query(
    `UPDATE legacy_supabase.import_batch b
     SET imported_public_rows=(SELECT count(*) FROM legacy_supabase.raw_row r WHERE r.batch_id=b.id AND r.source_schema='public'),
         status=CASE WHEN expected_public_rows=(SELECT count(*) FROM legacy_supabase.raw_row r WHERE r.batch_id=b.id AND r.source_schema='public')
                     THEN 'ARCHIVED' ELSE 'COUNT_MISMATCH' END,
         completed_at=now()
     WHERE id=$1::uuid`,
    [batchId],
  );
  console.log(`Archive batch complete: ${batchId}`);
} finally {
  await client.end();
}
