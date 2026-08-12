#!/usr/bin/env node
import path from 'node:path';
import { parseArgs, printPlan, publicSourceDescriptor, resolveWorkPath, writeJson } from './common.mjs';

const args = parseArgs();
const outFile = path.resolve(args.out || resolveWorkPath(null, ['inventory', 'source-schema.json']));

if (args.help) {
  console.log(`Usage: node scripts/migration/inventory-source-schema.mjs --execute [--out PATH]\n\nRequires SOURCE_DATABASE_URL for a database user with read-only catalogue access. Queries only PostgreSQL metadata and enables a read-only transaction.`);
  process.exit(0);
}
if (!args.execute) {
  printPlan('inventory-source-schema', { output: outFile, queries: 'PostgreSQL catalogue SELECT only', transaction: 'READ ONLY', databaseWrites: false });
  process.exit(0);
}
if (!process.env.SOURCE_DATABASE_URL) throw new Error('SOURCE_DATABASE_URL is required. Use a dedicated read-only source database role.');

const { Client } = await import('pg');
const client = new Client({ connectionString: process.env.SOURCE_DATABASE_URL, application_name: 'buysell-source-inventory' });
const queries = {
  tables: `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`,
  columns: `SELECT table_schema, table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`,
  constraints: `SELECT ns.nspname AS schema_name, cls.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class cls ON cls.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`,
  indexes: `SELECT schemaname AS schema_name, tablename AS table_name, indexname AS index_name, indexdef AS definition FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`,
  views: `SELECT schemaname AS schema_name, viewname AS view_name, definition FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`,
  functions: `SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result, p.prosecdef AS security_definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`,
  triggers: `SELECT event_object_schema AS schema_name, event_object_table AS table_name, trigger_name, event_manipulation, action_timing, action_statement FROM information_schema.triggers WHERE trigger_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`,
  policies: `SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name, permissive, roles, cmd, qual, with_check FROM pg_policies ORDER BY 1,2,3`,
  extensions: `SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY 1`,
};

await client.connect();
const result = { formatVersion: 1, generatedAt: new Date().toISOString(), source: publicSourceDescriptor(process.env.SOURCE_DATABASE_URL), readOnly: true };
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  for (const [name, sql] of Object.entries(queries)) result[name] = (await client.query(sql)).rows;
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
await writeJson(outFile, result);
console.log(`Source schema inventory: ${outFile}`);
