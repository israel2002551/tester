import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { initAuthCreds } from '@whiskeysockets/baileys';
import { authKeyName, createAuthCipher, openAuthState } from '../auth-store.js';

// In-memory stand-in for the whatsapp-listing-action session endpoints.
function fakeApi() {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    async authStateGet({ sessionId, keys }) {
      calls.push('get');
      return { values: Object.fromEntries(keys.filter(k => rows.has(`${sessionId}/${k}`)).map(k => [k, rows.get(`${sessionId}/${k}`)])) };
    },
    async authStateSet({ sessionId, entries }) {
      calls.push('set');
      for (const { key, value } of entries) {
        if (value === null) rows.delete(`${sessionId}/${key}`);
        else rows.set(`${sessionId}/${key}`, value);
      }
      return {};
    },
    async authStateClear({ sessionId }) {
      calls.push('clear');
      for (const key of [...rows.keys()]) if (key.startsWith(`${sessionId}/`)) rows.delete(key);
      return { cleared: true };
    },
  };
}

function withSupabaseEnv() {
  process.env.WHATSAPP_AUTH_STORE = 'supabase';
  process.env.WHATSAPP_AUTH_SESSION_ID = 'test_bot';
  process.env.WHATSAPP_AUTH_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}

test('names keys like the multi-file session folder', () => {
  assert.equal(authKeyName('session', '2348000000000:12'), 'session-2348000000000-12');
  assert.equal(authKeyName('app-state-sync-key', 'AAA/BBB='), 'app-state-sync-key-AAA__BBB=');
});

test('encrypts values and binds them to their key', () => {
  withSupabaseEnv();
  const cipher = createAuthCipher('test_bot');
  const stored = cipher.encrypt('creds', '{"secret":true}');
  assert.ok(!stored.includes('secret'));
  assert.equal(cipher.decrypt('creds', stored), '{"secret":true}');
  assert.throws(() => cipher.decrypt('pre-key-1', stored));
});

test('persists creds and signal keys across restarts', async () => {
  withSupabaseEnv();
  const api = fakeApi();

  const first = await openAuthState({ api });
  assert.equal(first.state.creds.registered, false);
  first.state.creds.registered = true;
  await first.saveCreds();
  await first.state.keys.set({ 'pre-key': { 1: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) }, 2: null } });

  for (const value of api.rows.values()) assert.ok(value.startsWith('v1:'));

  const second = await openAuthState({ api });
  assert.equal(second.state.creds.registered, true);
  assert.deepEqual(second.state.creds.noiseKey.private, first.state.creds.noiseKey.private);
  const { 1: preKey, 2: missing } = await second.state.keys.get('pre-key', ['1', '2']);
  assert.ok(Buffer.isBuffer(preKey.private));
  assert.deepEqual([...preKey.private], [4, 5, 6]);
  assert.equal(missing, undefined);

  await second.state.keys.set({ 'pre-key': { 1: null } });
  await second.clear();
  assert.equal(api.rows.size, 0);
});

test('starts from fresh credentials when nothing is stored', async () => {
  withSupabaseEnv();
  const auth = await openAuthState({ api: fakeApi() });
  assert.deepEqual(Object.keys(auth.state.creds).sort(), Object.keys(initAuthCreds()).sort());
});
