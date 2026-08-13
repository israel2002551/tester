import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_TABLES } from '../common.mjs';

test('source inventory covers every public table in the Supabase production snapshot', () => {
  const expected = [
    'advertisements', 'affiliate_earnings', 'broadcasts', 'commission_receipts',
    'coupon_redemptions', 'coupons', 'disputes', 'dropship_catalog', 'dropship_imports',
    'dropship_supplier_connections', 'flash_sales', 'kyc_verifications', 'landing_media',
    'messages', 'order_tracking', 'orders', 'payment_receipts', 'products', 'profiles',
    'push_subscriptions', 'referral_clicks', 'referrals', 'reviews', 'safe_hubs',
    'seller_analytics_events', 'seller_staff_permissions', 'service_bookings',
    'service_gigs', 'service_reviews', 'upcoming_products', 'wallet_transactions',
    'wishlists', 'withdrawals',
  ];
  assert.deepEqual(SOURCE_TABLES.map(({ name }) => name).sort(), expected);
  assert.equal(new Set(SOURCE_TABLES.map(({ name }) => name)).size, 33);
});
