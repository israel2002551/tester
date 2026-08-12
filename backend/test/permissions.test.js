import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTeamMutation, hasPlatformPermission, hasStorePermission } from '../src/auth/permissions.js';

test('role assignment records grant only their explicit platform capabilities', () => {
  const sourcingManager = { platformRoles: [{ role: 'SOURCING_MANAGER' }] };
  assert.equal(hasPlatformPermission(sourcingManager, 'sourcing.internal.read'), true);
  assert.equal(hasPlatformPermission(sourcingManager, 'payments.read'), false);
});

test('team mutation cannot demote owners or let managers grant admin access', () => {
  assert.throws(() => assertTeamMutation({ id: 'actor', role: 'OWNER' }, { id: 'owner', role: 'OWNER' }, 'ADMIN'), /owner membership/);
  assert.throws(() => assertTeamMutation({ id: 'actor', role: 'ADMIN' }, null, 'ADMIN'), /Only the store owner/);
  assert.throws(() => assertTeamMutation({ id: 'same', role: 'OWNER' }, { id: 'same', role: 'ADMIN' }, 'MANAGER'), /your own/);
  assert.doesNotThrow(() => assertTeamMutation({ id: 'owner', role: 'OWNER' }, null, 'ADMIN'));
});

test('store roles and explicit permissions compose', () => {
  assert.equal(hasStorePermission({ role: 'PRODUCT_MANAGER', permissions: [] }, 'PRODUCT_WRITE'), true);
  assert.equal(hasStorePermission({ role: 'SUPPORT_AGENT', permissions: [{ permission: 'PAYOUT_REQUEST' }] }, 'PAYOUT_REQUEST'), true);
  assert.equal(hasStorePermission({ role: 'SUPPORT_AGENT', permissions: [] }, 'FINANCE_READ'), false);
});
