import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Baileys 6.7.20+ omitted the required stream acknowledgement after a message
// was decrypted successfully. WhatsApp later terminates the connection with
// `Stream Errored (ack)`, then replays the same message on reconnect. Keep this
// small compatibility patch until the project can move to a verified 7.x fix.
const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..', 'node_modules', '@whiskeysockets', 'baileys');
const target = resolve(packageDir, 'lib', 'Socket', 'messages-recv.js');
const marker = resolve(packageDir, '.buysell-message-ack-patched');
const before = "cleanMessage(msg, authState.creds.me.id);\n                    await upsertMessage(msg, node.attrs.offline ? 'append' : 'notify');";
const after = "cleanMessage(msg, authState.creds.me.id);\n                    await sendMessageAck(node);\n                    await upsertMessage(msg, node.attrs.offline ? 'append' : 'notify');";

if (!existsSync(target)) {
  console.warn('[postinstall] Baileys acknowledgement patch skipped: messages-recv.js was not found.');
  process.exit(0);
}

const source = readFileSync(target, 'utf8');
if (source.includes(after)) {
  writeFileSync(marker, 'BUYSELL Baileys message acknowledgement patch applied\n', 'utf8');
  console.info('[postinstall] Baileys incoming-message acknowledgement patch is already applied.');
  process.exit(0);
}
if (!source.includes(before)) {
  console.error('[postinstall] Baileys acknowledgement patch could not be applied: installed source does not match the supported release.');
  process.exit(1);
}

writeFileSync(target, source.replace(before, after), 'utf8');
writeFileSync(marker, 'BUYSELL Baileys message acknowledgement patch applied\n', 'utf8');
console.info('[postinstall] Restored Baileys acknowledgement for successfully decrypted messages.');
