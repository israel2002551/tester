import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts'];
const files = [];
function visit(path) {
  for (const entry of readdirSync(path)) {
    const candidate = resolve(path, entry);
    if (statSync(candidate).isDirectory()) visit(candidate);
    else if (/\.(?:js|mjs)$/.test(entry) && !candidate.endsWith('check-syntax.mjs')) files.push(candidate);
  }
}
roots.forEach(visit);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} backend modules.`);
