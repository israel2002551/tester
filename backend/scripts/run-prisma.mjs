import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = resolve(backendRoot, '..', 'database', 'prisma', 'schema.prisma');
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/buysell';
const directUrl = process.env.DIRECT_DATABASE_URL || databaseUrl;
const args = process.argv.slice(2);

if (!args.length) {
  console.error('Usage: node scripts/run-prisma.mjs <command> [...arguments]');
  process.exit(2);
}

const result = spawnSync(process.execPath, [prismaCli, ...args, '--schema', schema], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: directUrl },
});
process.exit(result.status ?? 1);
