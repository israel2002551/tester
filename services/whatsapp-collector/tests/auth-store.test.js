import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { initAuthCreds } from '@whiskeysockets/baileys';
import { authKeyName, createAuthCipher, forgetSupabaseAuthStates, openAuthState } from '../auth-store.js';

// In-memory stand-in for the whatsapp-listing-action session endpoints.
function fakeApi({ supportsList = true } = {}) {
  const rows = new Map();
  const calls = [];
  let failNextSet = false;
  return {
    rows,
    calls,
    failNextSet() { failNextSet = true; },
    async authStateList({ sessionId, after }) {
      calls.push('list');
      if (!supportsList) throw new Error('Unknown action.');
      const names = [...rows.keys()].filter(k => k.startsWith(`${sessionId}/`)).map(k => k.slice(sessionId.length + 1)).sort()
        .filter(name => !after || name > after);
      const page = names.slice(0, 2);
      return {
        values: Object.fromEntries(page.map(name => [name, rows.get(`${sessionId}/${name}`)])),
        next: names.length > 2 ? page[page.length - 1] : null,
      };
    },
    async authStateGet({ sessionId, keys }) {
      calls.push('get');
      return { values: Object.fromEntries(keys.filter(k => rows.has(`${sessionId}/${k}`)).map(k => [k, rows.get(`${sessionId}/${k}`)])) };
    },
    async authStateSet({ sessionId, entries }) {
      calls.push('set');
      if (failNextSet) {
        failNextSet = false;
        throw new Error('network down');
      }
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

const preKey = (n) => ({ public: Buffer.from([n, 1]), private: Buffer.from([n, 2]) });

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
  await first.state.keys.set({ 'pre-key': { 1: preKey(1), 2: preKey(2), 3: null } });
  await first.flush();

  for (const value of api.rows.values()) assert.ok(value.startsWith('v1:'));

  forgetSupabaseAuthStates(api); // a new process
  const second = await openAuthState({ api });
  assert.notEqual(second, first);
  assert.equal(second.state.creds.registered, true);
  assert.deepEqual(second.state.creds.noiseKey.private, first.state.creds.noiseKey.private);
  const { 1: one, 2: two, 3: missing } = await second.state.keys.get('pre-key', ['1', '2', '3']);
  assert.ok(Buffer.isBuffer(one.private));
  assert.deepEqual([...two.private], [2, 2]);
  assert.equal(missing, null);

  await second.clear();
  assert.equal(api.rows.size, 0);
});

test('reads come from memory and writes are batched in the background', async () => {
  withSupabaseEnv();
  const api = fakeApi();
  const auth = await openAuthState({ api });
  api.calls.length = 0;

  await auth.state.keys.set({ session: { a: { n: 1 } } });
  await auth.state.keys.set({ session: { a: { n: 2 }, b: { n: 3 } } });
  const read = await auth.state.keys.get('session', ['a', 'b', 'zzz']);
  assert.deepEqual(read, { a: { n: 2 }, b: { n: 3 }, zzz: null });
  assert.deepEqual(api.calls, [], 'no network round trips while handling messages');

  await auth.flush();
  assert.deepEqual(api.calls, ['set'], 'both writes saved in one request');
  const stored = createAuthCipher('test_bot').decrypt('session-a', api.rows.get('test_bot/session-a'));
  assert.equal(stored, '{"n":2}', 'latest value wins');
});

test('a reconnect in the same process reuses the in-memory session', async () => {
  withSupabaseEnv();
  const api = fakeApi();
  const first = await openAuthState({ api });
  const again = await openAuthState({ api });
  assert.equal(again, first);
});

test('a failed save is retried without losing the change', async () => {
  withSupabaseEnv();
  const api = fakeApi();
  const auth = await openAuthState({ api });
  api.failNextSet();
  await auth.state.keys.set({ 'pre-key': { 9: preKey(9) } });
  await auth.flush(); // fails, re-queued
  assert.ok(!api.rows.has('test_bot/pre-key-9'));
  await auth.flush();
  assert.ok(api.rows.has('test_bot/pre-key-9'));
});

test('falls back to on-demand loading before the list action is deployed', async () => {
  withSupabaseEnv();
  const api = fakeApi({ supportsList: false });
  const writer = await openAuthState({ api });
  await writer.state.keys.set({ 'pre-key': { 5: preKey(5) } });
  await writer.saveCreds();

  forgetSupabaseAuthStates(api);
  const auth = await openAuthState({ api });
  assert.match(auth.description, /loaded on demand/);
  const first = await auth.state.keys.get('pre-key', ['5']);
  assert.deepEqual([...first[5].private], [5, 2]);
  const gets = api.calls.filter(call => call === 'get').length;
  await auth.state.keys.get('pre-key', ['5']);
  assert.equal(api.calls.filter(call => call === 'get').length, gets, 'second read served from memory');
});

test('starts from fresh credentials when nothing is stored', async () => {
  withSupabaseEnv();
  const auth = await openAuthState({ api: fakeApi() });
  assert.deepEqual(Object.keys(auth.state.creds).sort(), Object.keys(initAuthCreds()).sort());
});
