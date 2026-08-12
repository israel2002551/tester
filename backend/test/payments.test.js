import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateVerifiedCharge, verifyFlutterwaveSignature } from '../src/services/payments.js';

const payment = { internalReference: 'PAY-123', currency: 'NGN', amountKobo: 25_050n };

test('webhook signature uses raw body HMAC SHA-256 and timing-safe equality', () => {
  const raw = Buffer.from('{"event":"charge.completed"}');
  const signature = createHmac('sha256', 'test-secret').update(raw).digest('base64');
  assert.equal(verifyFlutterwaveSignature(raw, signature, 'test-secret'), true);
  assert.equal(verifyFlutterwaveSignature(raw, `${signature.slice(0, -1)}x`, 'test-secret'), false);
});

test('verified charges require exact reference/currency and sufficient amount', () => {
  assert.deepEqual(validateVerifiedCharge({ id: 88, status: 'successful', tx_ref: 'PAY-123', currency: 'NGN', amount: '250.50', flw_ref: 'FLW-1' }, payment), { receivedKobo: 25_050n, providerTransactionId: '88', providerReference: 'FLW-1' });
  assert.throws(() => validateVerifiedCharge({ id: 88, status: 'successful', tx_ref: 'wrong', currency: 'NGN', amount: '250.50' }, payment), /reference/);
  assert.throws(() => validateVerifiedCharge({ id: 88, status: 'successful', tx_ref: 'PAY-123', currency: 'USD', amount: '250.50' }, payment), /currency/);
  assert.throws(() => validateVerifiedCharge({ id: 88, status: 'successful', tx_ref: 'PAY-123', currency: 'NGN', amount: '250.49' }, payment), /less/);
  assert.throws(() => validateVerifiedCharge({ id: 88, status: 'successful', tx_ref: 'PAY-123', currency: 'NGN', amount: '250.501' }, payment), /less/);
});
