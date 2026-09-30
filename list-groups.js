import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const collectorDir = join(__dirname, 'services', 'whatsapp-collector');
const scriptPath = join(collectorDir, 'list-groups.js');

const child = spawn(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  cwd: collectorDir,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
