import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSettingKeys, validateSafeSetting } from '../src/services/settings.js';

test('settings registry permits product behavior but rejects secret-shaped keys', () => {
  assert.ok(safeSettingKeys.includes('checkout'));
  assert.deepEqual(validateSafeSetting('homepage', { announcementEnabled: true, announcement: 'Market day' }), { announcementEnabled: true, announcement: 'Market day' });
  assert.throws(() => validateSafeSetting('flutterwave_secret', 'secret'), /unknown or may contain sensitive/);
  assert.throws(() => validateSafeSetting('support', { email: 'bad' }), /email/);
});
