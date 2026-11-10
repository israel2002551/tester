import {
  BufferJSON,
  initAuthCreds,
  proto,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';

// Matches useMultiFileAuthState's file naming so a local session folder can be
// uploaded as-is: `creds.json` -> `creds`, `session-123.0.json` -> `session-123.0`.
export function authKeyName(type, id) {
  return `${type}-${id}`.replace(/\//g, '__').replace(/:/g, '-');
}

export function authStoreMode() {
  return String(process.env.WHATSAPP_AUTH_STORE || 'file').trim().toLowerCase() === 'supabase' ? 'supabase' : 'file';
}

export function authSessionId() {
  const id = String(process.env.WHATSAPP_AUTH_SESSION_ID || 'bot1').trim();
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

// One in-memory session per API client and process, so a socket reconnect
// reuses it instead of reloading (and cannot race unsaved writes).
const supabaseStores = new WeakMap();

function openSupabaseAuthState(api) {
  if (!supabaseStores.has(api)) {
    const opening = createSupabaseAuthState(api, () => supabaseStores.delete(api));
    supabaseStores.set(api, opening);
    opening.catch(() => supabaseStores.delete(api));
  }
  return supabaseStores.get(api);
}

/** Test hook: behave like a fresh process. */
export function forgetSupabaseAuthStates(api) {
  supabaseStores.delete(api);
}

/**
 * Keeps the whole session in memory and saves changes to Supabase in the
 * background. Signal key reads and writes happen on every incoming message;
 * waiting on the network for each one made message handling so slow that
 * WhatsApp closed the connection for missing acknowledgements
 * ("Stream Errored (ack)").
 */
async function createSupabaseAuthState(api, onClear) {
  const sessionId = authSessionId();
  const cipher = createAuthCipher(sessionId);

  // JSON text per key, exactly as the session files store it; null = known absent.
  const memory = new Map();
  let fullyLoaded = false;
  try {
    let after = null;
    do {
      const page = await api.authStateList({ sessionId, after });
      for (const [name, stored] of Object.entries(page?.values || {})) memory.set(name, cipher.decrypt(name, stored));
      after = page?.next || null;
    } while (after);
    fullyLoaded = true;
  } catch (error) {
    if (!/unknown action/i.test(error?.message || '')) throw error;
    // Edge Function without auth_state_list: fetch each key once, on first use.
    memory.clear();
  }

  const ensureLoaded = async (names) => {
    if (fullyLoaded) return;
    const missing = [...new Set(names)].filter(name => !memory.has(name));
    for (const part of chunk(missing, 200)) {
      const values = (await api.authStateGet({ sessionId, keys: part }))?.values || {};
      for (const name of part) memory.set(name, name in values ? cipher.decrypt(name, values[name]) : null);
    }
  };
  const readValue = (name) => {
    const text = memory.get(name);
    return text == null ? null : JSON.parse(text, BufferJSON.reviver);
  };

  // Writes are coalesced per key and saved strictly in order: Signal ratchets
  // overwrite and delete the same keys in quick succession.
  const pending = new Map();
  let flushing = Promise.resolve();
  let flushTimer = null;
  let failures = 0;

  const schedule = (delayMs = 300) => {
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, delayMs);
  };
  const persist = async () => {
    if (!pending.size) return;
    const batch = [...pending];
    pending.clear();
    try {
      const encrypted = batch.map(([name, text]) => ({ key: name, value: text === null ? null : cipher.encrypt(name, text) }));
      for (const part of chunkEntries(encrypted)) await api.authStateSet({ sessionId, entries: part });
      failures = 0;
    } catch (error) {
      // Keep anything a newer write has not replaced, then retry with backoff.
      for (const [name, text] of batch) if (!pending.has(name)) pending.set(name, text);
      failures += 1;
      console.warn(`[Session] Could not save the WhatsApp session to Supabase (attempt ${failures}); retrying.`, error?.message || error);
      schedule(Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)));
    }
  };
  const flush = () => {
    flushing = flushing.then(persist, persist);
    return flushing;
  };
  const flushNow = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    return flush();
  };
  const write = (name, value) => {
    const text = value == null ? null : JSON.stringify(value, BufferJSON.replacer);
    memory.set(name, text);
    pending.set(name, text);
    schedule();
  };

  await ensureLoaded(['creds']);
  const creds = readValue('creds') || initAuthCreds();
  const keys = {
    get: async (type, ids) => {
      const names = ids.map(id => authKeyName(type, id));
      await ensureLoaded(names);
      const data = {};
      ids.forEach((id, index) => {
        let value = readValue(names[index]);
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
        data[id] = value;
      });
      return data;
    },
    set: async (data) => {
      for (const type in data) {
        for (const id in data[type]) write(authKeyName(type, id), data[type][id] || null);
      }
    },
  };

  return {
    state: { creds, keys },
    // Resolves once everything queued so far is in Supabase; the post-pairing
    // restart must find the new credentials there.
    saveCreds: () => {
      write('creds', creds);
      return flushNow();
    },
    flush: flushNow,
    clear: async () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      pending.clear();
      await flushing;
      await api.authStateClear({ sessionId });
      memory.clear();
      onClear();
    },
    description: `Supabase (session "${sessionId}", ${fullyLoaded ? `${memory.size} keys loaded` : 'loaded on demand'})`,
  };
}

async function openFileAuthState(sessionDir) {
  mkdirSync(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  return {
    state,
    saveCreds,
    flush: async () => {},
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
