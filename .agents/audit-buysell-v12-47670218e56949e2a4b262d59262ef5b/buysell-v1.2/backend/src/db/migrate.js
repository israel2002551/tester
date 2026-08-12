import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(here, '../../database/migrations');

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

async function files() {
  return (await fs.readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
}

async function applied() {
  const { rows } = await pool.query('SELECT filename, applied_at FROM schema_migrations ORDER BY filename');
  return rows;
}

async function up() {
  await ensureTable();
  const done = new Set((await applied()).map((r) => r.filename));
  for (const filename of await files()) {
    if (done.has(filename)) continue;
    const sql = await fs.readFile(path.join(migrationDir, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function status() {
  await ensureTable();
  const done = new Map((await applied()).map((r) => [r.filename, r.applied_at]));
  for (const filename of await files()) console.log(`${done.has(filename) ? 'applied' : 'pending'}  ${filename}`);
}

const command = process.argv[2] || 'status';
try {
  if (command === 'up') await up(); else await status();
} finally {
  await pool.end();
}
