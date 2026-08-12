#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const targets = [path.join(repositoryRoot, 'frontend', 'src'), path.join(repositoryRoot, 'frontend', 'dist')];
const prohibited = String.fromCharCode(49, 54, 56, 56).toLowerCase();
const textExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.map', '.xml', '.txt', '.svg']);
const findings = [];

async function walk(target) {
  let info;
  try { info = await stat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (info.isDirectory()) {
    for (const entry of await readdir(target)) await walk(path.join(target, entry));
    return;
  }
  if (!textExtensions.has(path.extname(target).toLowerCase())) return;
  const contents = await readFile(target, 'utf8');
  const lower = contents.toLowerCase();
  let offset = lower.indexOf(prohibited);
  while (offset !== -1) {
    const line = contents.slice(0, offset).split(/\r?\n/).length;
    findings.push(`${path.relative(repositoryRoot, target)}:${line}`);
    offset = lower.indexOf(prohibited, offset + prohibited.length);
  }
}

for (const target of targets) await walk(target);
if (findings.length) {
  console.error(`Public sourcing boundary failed. Prohibited provider exposure found:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('Public sourcing boundary: PASS (frontend source and production output are provider-neutral).');
