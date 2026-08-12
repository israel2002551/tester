import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUser } from '../src/auth/middleware.js';

function migratedDb() {
  const active = { id: 'user-1', email: 'buyer@example.com', status: 'ACTIVE', profile: {}, platformRoles: [], storeMemberships: [] };
  return {
    authIdentity: { findUnique: async () => null, create: async () => ({ user: active }) },
    user: { findUnique: async () => active, update: async () => active },
  };
}

test('verified Supabase email can link a migrated local user', async () => {
  const user = await resolveUser(migratedDb(), { sub: 'provider-1', email: 'buyer@example.com', email_verified: true });
  assert.equal(user.id, 'user-1');
});

test('unverified email cannot claim a migrated local user', async () => {
  await assert.rejects(() => resolveUser(migratedDb(), { sub: 'provider-2', email: 'buyer@example.com', email_verified: false }), /Verify this email/);
});
