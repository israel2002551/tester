// Copies a WhatsApp session that was paired locally (SESSION_DIR) into the
// encrypted Supabase session store used when WHATSAPP_AUTH_STORE=supabase.
//
// Stop every running copy of Bot 2 first: two processes sharing one session
// disconnect each other and corrupt its encryption state.
//
// Usage: npm run upload-session [-- --replace]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { authSessionId, chunkEntries, createAuthCipher } from './auth-store.js';
import { BuySellListingsApi } from './buysell-api.js';

const sessionDir = process.env.SESSION_DIR || './wa_vision_auth_session';
const replace = process.argv.includes('--replace');
const api = new BuySellListingsApi();
const sessionId = authSessionId();
const cipher = createAuthCipher(sessionId);

const files = readdirSync(sessionDir).filter(name => name.endsWith('.json'));
const entries = files.map(file => ({
  key: file.slice(0, -'.json'.length),
  plaintext: readFileSync(join(sessionDir, file), 'utf8'),
}));

const creds = entries.find(entry => entry.key === 'creds');
if (!creds) throw new Error(`No creds.json in ${sessionDir}. Pair the bot locally first.`);
if (!JSON.parse(creds.plaintext).registered) throw new Error('The local session is not linked yet. Pair the bot locally first.');

const existing = await api.authStateGet({ sessionId, keys: ['creds'] });
if (existing?.values?.creds && !replace) {
  console.error(`Supabase already holds a session "${sessionId}". Re-run with --replace to overwrite it.`);
  process.exit(1);
}

await api.authStateClear({ sessionId });
const encrypted = entries.map(({ key, plaintext }) => ({ key, value: cipher.encrypt(key, plaintext) }));
for (const part of chunkEntries(encrypted)) {
  await api.authStateSet({ sessionId, entries: part });
}
console.log(`Uploaded ${entries.length} session files from ${sessionDir} to Supabase session "${sessionId}".`);
