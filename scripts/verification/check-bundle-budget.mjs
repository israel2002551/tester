#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', '..', 'frontend', 'dist');
const budgets = { '.js': 650_000, '.css': 250_000 };
const failures = [];
let filesChecked = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    const extension = path.extname(entry.name);
    if (!budgets[extension]) continue;
    const bytes = (await stat(file)).size;
    filesChecked += 1;
    if (bytes > budgets[extension]) failures.push(`${path.relative(dist, file)} is ${bytes} bytes (budget ${budgets[extension]}).`);
  }
}

try { await walk(dist); } catch (error) {
  if (error.code === 'ENOENT') throw new Error('Frontend build output is missing. Run npm run build first.');
  throw error;
}
if (failures.length) {
  console.error(`Bundle budget failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Bundle budget: PASS (${filesChecked} JavaScript/CSS assets checked).`);
