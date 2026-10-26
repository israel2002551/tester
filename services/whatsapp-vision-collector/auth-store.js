import {
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import pino from 'pino';

// Matches useMultiFileAuthState's file naming so a local session folder can be
// uploaded as-is: `creds.json` -> `creds`, `session-123.0.json` -> `session-123.0`.
export function authKeyName(type, id) {
  return `${type}-${id}`.replace(/\//g, '__').replace(/:/g, '-');
}

export function authStoreMode() {
  return String(process.env.WHATSAPP_AUTH_STORE || 'file').trim().toLowerCase() === 'supabase' ? 'supabase' : 'file';
}

export function authSessionId() {
  const id = String(process.env.WHATSAPP_AUTH_SESSION_ID || 'bot2').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('WHATSAPP_AUTH_SESSION_ID may only contain letters, digits, "_" and "-".');
  return id;
}

function encryptionKey() {
  const raw = String(process.env.WHATSAPP_AUTH_ENCRYPTION_KEY || '').trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('WHATSAPP_AUTH_ENCRYPTION_KEY must be 32 random bytes (64 hex characters or base64).');
  }
  return key;
}

// The WhatsApp session is full account access, so it is encrypted before it
// leaves this process. Supabase only ever stores ciphertext; the row identity is
// bound in as associated data so rows cannot be swapped between keys.
export function createAuthCipher(sessionId) {
  const key = encryptionKey();
  return {
    encrypt(name, plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`${sessionId}/${name}`));
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
    },
    decrypt(name, stored) {
      const [version, iv, tag, data] = String(stored || '').split(':');
      if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error(`Stored WhatsApp auth value "${name}" has an unknown format.`);
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(`${sessionId}/${name}`));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Groups encrypted entries into requests of at most 100 entries and ~1.5MB, so
// large app-state blobs never push a single Edge Function call over its limits.
export function chunkEntries(entries, maxCount = 100, maxChars = 1_500_000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    const length = (entry.value?.length || 0) + entry.key.length;
    if (current.length && (current.length >= maxCount || size + length > maxChars)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function openSupabaseAuthState(api) {
  const sessionId = authSessionId();
  const cipher = createAuthCipher(sessionId);

  const readValues = async (names) => {
    const values = {};
    for (const part of chunk(names, 200)) {
      const result = await api.authStateGet({ sessionId, keys: part });
      for (const [name, stored] of Object.entries(result?.values || {})) {
        values[name] = JSON.parse(cipher.decrypt(name, stored), BufferJSON.reviver);
      }
    }
    return values;
  };

  // Writes are applied strictly in order: Signal ratchets overwrite and delete
  // the same keys in quick succession, and a reordered write corrupts sessions.
  let writeChain = Promise.resolve();
  const writeValues = (entries) => {
    const run = writeChain.then(async () => {
      const encrypted = entries.map(({ name, value }) => ({
        key: name,
        value: value === null ? null : cipher.encrypt(name, JSON.stringify(value, BufferJSON.replacer)),
      }));
      for (const part of chunkEntries(encrypted)) {
        await api.authStateSet({ sessionId, entries: part });
      }
    });
    writeChain = run.catch(() => {});
    return run;
  };

  const creds = (await readValues(['creds'])).creds || initAuthCreds();
  const keys = {
    get: async (type, ids) => {
      const names = ids.map(id => authKeyName(type, id));
      const values = await readValues(names);
      const data = {};
      ids.forEach((id, index) => {
        let value = values[names[index]] ?? null;
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
        data[id] = value;
      });
      return data;
    },
    set: async (data) => {
      const entries = [];
      for (const type in data) {
        for (const id in data[type]) {
          entries.push({ name: authKeyName(type, id), value: data[type][id] || null });
        }
      }
      if (entries.length) await writeValues(entries);
    },
  };

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(keys, pino({ level: 'silent' })),
    },
    saveCreds: () => writeValues([{ name: 'creds', value: creds }]),
    clear: async () => {
      await writeChain;
      await api.authStateClear({ sessionId });
    },
    description: `Supabase (session "${sessionId}")`,
  };
}

async function openFileAuthState(sessionDir) {
  mkdirSync(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  return {
    state,
    saveCreds,
    clear: async () => {
      try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      mkdirSync(sessionDir, { recursive: true });
    },
    description: `local folder ${sessionDir}`,
  };
}

/**
 * Opens the WhatsApp auth state. WHATSAPP_AUTH_STORE=supabase keeps the session
 * in Supabase so hosts without a persistent disk (Render free) survive restarts
 * and redeploys without re-pairing; the default keeps the local folder.
 */
export function openAuthState({ api, sessionDir }) {
  return authStoreMode() === 'supabase' ? openSupabaseAuthState(api) : openFileAuthState(sessionDir);
}
