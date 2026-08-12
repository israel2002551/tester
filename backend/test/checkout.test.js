import test from 'node:test';
import assert from 'node:assert/strict';
import { priceCheckoutItems } from '../src/services/checkout.js';

function cartItem({ quantity = 2, price = 10_000n, shipping = 500n, stock = 5, storeId = 'store-a' } = {}) {
  return {
    quantity,
    variant: {
      id: 'variant-a', sku: 'SKU-A', name: 'Default', priceKobo: price, active: true,
      inventory: { onHand: stock, reserved: 0 },
      product: { id: 'product-a', name: 'Rice cooker', status: 'ACTIVE', deletedAt: null, shippingFeeKobo: shipping, storeId, store: { status: 'ACTIVE' } },
    },
  };
}

test('checkout totals are derived from database product prices', () => {
  const result = priceCheckoutItems([cartItem()], null);
  assert.equal(result.subtotalKobo, 20_000n);
  assert.equal(result.shippingKobo, 1_000n);
  assert.equal(result.totalKobo, 21_000n);
});

test('coupon only discounts eligible store subtotal', () => {
  const coupon = { active: true, storeId: 'store-a', startsAt: null, expiresAt: null, maxUses: null, usedCount: 0, minimumKobo: 0n, percentOffBps: 1_000, fixedOffKobo: null };
  const result = priceCheckoutItems([cartItem(), { ...cartItem({ quantity: 1, price: 50_000n, storeId: 'store-b' }), variant: { ...cartItem({ quantity: 1, price: 50_000n, storeId: 'store-b' }).variant, id: 'variant-b' } }], coupon);
  assert.equal(result.discountKobo, 2_000n);
  assert.equal(result.totalKobo, 69_500n);
});

test('checkout rejects unavailable inventory', () => {
  assert.throws(() => priceCheckoutItems([cartItem({ quantity: 6, stock: 5 })], null), /enough available stock/);
});
