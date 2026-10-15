import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractNairaPriceCandidates,
  hasPriceInText,
  parseNairaAmount,
  stripPriceFromText,
} from '../parser.js';
import { KeyedTaskQueue } from '../queue.js';

test('normalizes common Nigerian price formats', () => {
  const cases = [
    ['Ladies top 5,500', 5_500],
    ['₦5,500', 5_500],
    ['N5500', 5_500],
    ['5 500', 5_500],
    ['5.5k', 5_500],
    ['1.2m', 1_200_000],
    ['five thousand five hundred naira', 5_500],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseNairaAmount(input), expected, input);
  }
});

test('detects contextual prices without mistaking years and phone numbers for prices', () => {
  assert.equal(hasPriceInText('Ladies top 5,500'), true);
  assert.equal(hasPriceInText('5500 each'), true);
  assert.equal(hasPriceInText('10 Oct 2026', { mediaContext: true }), false);
  assert.equal(hasPriceInText('Call 08035501234', { mediaContext: true }), false);
  assert.equal(extractNairaPriceCandidates('Ladies top 5,500', { mediaContext: true })[0].amount, 5_500);
  assert.equal(stripPriceFromText('Ladies top ₦5,500').includes('5,500'), false);
});

test('keyed queue keeps one seller in order while allowing another seller to run', async () => {
  const seen = [];
  const queue = new KeyedTaskQueue({ concurrency: 2 });
  await Promise.all([
    queue.enqueue('seller-a', async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      seen.push('a1');
    }),
    queue.enqueue('seller-a', async () => seen.push('a2')),
    queue.enqueue('seller-b', async () => seen.push('b1')),
  ]);
  assert.ok(seen.indexOf('a1') < seen.indexOf('a2'));
  assert.equal(queue.snapshot.pending, 0);
  assert.equal(queue.snapshot.active, 0);
});
