import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDiscount, kobo, majorUnits, percentage } from '../src/lib/money.js';
import { allowedTransitions, assertTransition } from '../src/lib/transitions.js';
import { aggregateStoreOrderStatus } from '../src/services/orders.js';

test('money stays in exact integer minor units', () => {
  assert.equal(kobo('900719925474099312345'), 900719925474099312345n);
  assert.equal(percentage(10_001n, 300), 300n);
  assert.equal(clampDiscount(12_000n, 10_000n), 10_000n);
  assert.equal(majorUnits(123_456n), '1234.56');
  assert.throws(() => kobo(1.5), /non-negative integer/);
});

test('multi-store parent status follows the least-advanced active fulfilment', () => {
  assert.equal(aggregateStoreOrderStatus(['READY', 'PROCESSING'], 'PAID'), 'PROCESSING');
  assert.equal(aggregateStoreOrderStatus(['READY', 'READY'], 'PROCESSING'), 'READY');
  assert.equal(aggregateStoreOrderStatus(['DELIVERED', 'IN_TRANSIT'], 'READY'), 'IN_TRANSIT');
  assert.equal(aggregateStoreOrderStatus(['READY', 'CANCELLED'], 'PROCESSING'), 'PROCESSING');
});

test('order and sourcing state machines reject skipped transitions', () => {
  assert.doesNotThrow(() => assertTransition('order', 'PAID', 'PROCESSING'));
  assert.throws(() => assertTransition('order', 'PAID', 'DELIVERED'), /cannot move/);
  assert.deepEqual(allowedTransitions('sourcing', 'QUOTE_READY'), ['AWAITING_PAYMENT', 'UNDER_REVIEW', 'CANCELLED']);
});
