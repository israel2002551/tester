import { describe, expect, it } from 'vitest';
import { normalizeProduct } from '../lib/api';

describe('frontend API normalization', () => {
  it('converts backend kobo values, media and inventory into UI product values', () => {
    const product = normalizeProduct({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'test-product',
      name: 'Test product',
      shippingFeeKobo: '150000',
      variants: [{
        id: '22222222-2222-4222-8222-222222222222',
        priceKobo: '250000',
        compareAtKobo: '300000',
        inventory: { onHand: 5, reserved: 2 },
      }],
      media: [{ asset: { publicUrl: 'https://cdn.example.test/product.jpg' } }],
      store: { id: '33333333-3333-4333-8333-333333333333', slug: 'sample-store', name: 'Sample store' },
    });

    expect(product.price).toBe(2500);
    expect(product.compareAtPrice).toBe(3000);
    expect(product.shippingFee).toBe(1500);
    expect(product.stock).toBe(3);
    expect(product.variantId).toBe('22222222-2222-4222-8222-222222222222');
    expect(product.image).toBe('https://cdn.example.test/product.jpg');
    expect(product.store?.name).toBe('Sample store');
  });
});
