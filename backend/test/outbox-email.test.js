import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmailTemplate } from '../src/services/email.js';
import { claimOutboxBatch, processOutboxEvent, retryDelay } from '../src/services/outbox.js';
import { paymentRedirectUrl } from '../src/services/payments.js';

test('email templates escape user-derived content in HTML', () => {
  const email = renderEmailTemplate('message_received', { senderName: '<script>alert(1)</script>' });
  assert.equal(email.html.includes('<script>'), false);
  assert.equal(email.html.includes('&lt;script&gt;'), true);
  assert.match(email.text, /<script>alert/);
});

test('outbox retry delay grows exponentially and is capped', () => {
  assert.equal(retryDelay(1), 15_000);
  assert.equal(retryDelay(3), 60_000);
  assert.equal(retryDelay(30), 21_600_000);
});

test('outbox claim uses optimistic lease and skips lost races', async () => {
  const event = { id: 'e1', attempts: 0, availableAt: new Date('2026-01-01T00:00:00Z') };
  const db = { outboxEvent: { findMany: async () => [event], updateMany: async () => ({ count: 0 }) } };
  assert.deepEqual(await claimOutboxBatch(db, { now: new Date('2026-01-02T00:00:00Z') }), []);
});

test('unhandled outbox topics are marked processed rather than retried forever', async () => {
  let update;
  const db = { outboxEvent: { update: async (input) => { update = input; } } };
  const result = await processOutboxEvent(db, { id: 'e2', topic: 'unknown.topic', payload: {}, attempts: 1 });
  assert.equal(result.ok, true);
  assert.ok(update.data.processedAt instanceof Date);
});

test('payment redirect preserves trusted query and adds payment context', () => {
  const url = new URL(paymentRedirectUrl('pay id', 'order/id', 'https://shop.example/checkout/success?campaign=spring'));
  assert.equal(url.searchParams.get('campaign'), 'spring');
  assert.equal(url.searchParams.get('payment'), 'pay id');
  assert.equal(url.searchParams.get('order'), 'order/id');
});
