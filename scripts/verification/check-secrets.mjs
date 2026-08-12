#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const roots = ['backend', 'frontend', 'database', 'scripts'].map((part) => path.join(repositoryRoot, part));
const ignored = new Set(['node_modules', 'dist', 'coverage']);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Flutterwave secret', /\bFLWSECK-(?!example|your)[A-Za-z0-9_-]{12,}\b/i],
  ['Supabase service JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
];
const findings = [];

async function walk(target) {
  let info;
  try { info = await stat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (info.isDirectory()) {
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      await walk(path.join(target, entry.name));
    }
    return;
  }
  if (info.size > 2_000_000 || /\.(png|jpe?g|webp|woff2?|zip|ico)$/i.test(target)) return;
  const contents = await readFile(target, 'utf8').catch(() => '');
  for (const [label, pattern] of patterns) if (pattern.test(contents)) findings.push(`${label}: ${path.relative(repositoryRoot, target)}`);
}

for (const root of roots) await walk(root);
if (findings.length) {
  console.error(`Secret scan failed:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('Repository secret pattern scan: PASS.');
