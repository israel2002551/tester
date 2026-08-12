import assert from 'node:assert/strict';
import test from 'node:test';
import { transformSourceRow } from '../transforms.mjs';

test('profile migration preserves a Supabase UUID as the auth subject and internal user id', () => {
  const id = '1ea45f4e-8112-4c37-8dd1-699e2d4d3909';
  const records = transformSourceRow('profiles', { id, email: 'BUYER@EXAMPLE.COM', name: 'Ada Buyer', role: 'buyer' });
  const user = records.find((record) => record.targetEntity === 'User').data;
  const auth = records.find((record) => record.targetEntity === 'AuthIdentity').data;
  assert.equal(user.id, id);
  assert.equal(user.email, 'buyer@example.com');
  assert.equal(auth.providerSubject, id);
  assert.equal(auth.userId, id);
});

test('seller profile produces a stable store, owner membership, and ledger', () => {
  const row = { id: '835cc9c7-dbd5-4a9e-9d48-fbdd6be48fa5', role: 'seller', business_name: 'Ada Stores' };
  const first = transformSourceRow('profiles', row);
  const second = transformSourceRow('profiles', row);
  assert.deepEqual(first.map((record) => record.data.id), second.map((record) => record.data.id));
  assert.ok(first.some((record) => record.targetEntity === 'Store'));
  assert.ok(first.some((record) => record.targetEntity === 'LedgerAccount'));
});

test('product migration converts major currency values to integer minor units', () => {
  const records = transformSourceRow('products', { id: 'p-1', seller_id: 's-1', name: 'Phone', price: 1250.5, stock_quantity: 7 });
  assert.equal(records.find((record) => record.targetEntity === 'ProductVariant').data.priceKobo, '125050');
  assert.equal(records.find((record) => record.targetEntity === 'InventoryItem').data.onHand, 7);
});

test('domain-specific status maps only emit values accepted by each target enum', () => {
  const seller = transformSourceRow('profiles', { id: 'seller-1', role: 'seller', business_name: 'Review Store', store_status: 'draft' });
  assert.equal(seller.find((record) => record.targetEntity === 'Store').data.status, 'PENDING');

  const product = transformSourceRow('products', { id: 'p-2', seller_id: 'seller-1', name: 'Pending item', price: 10, status: 'pending' });
  assert.equal(product.find((record) => record.targetEntity === 'Product').data.status, 'DRAFT');

  const order = transformSourceRow('orders', { id: 'o-1', buyer_id: 'buyer-1', seller_id: 'seller-1', status: 'rejected', total: 10, items: [] });
  assert.equal(order[0].data.order.status, 'CANCELLED');

  const payout = transformSourceRow('withdrawals', { id: 'w-1', seller_id: 'seller-1', status: 'approved', amount: 10 });
  assert.equal(payout[0].data.payout.status, 'APPROVED');
});

test('KYC subjects, broadcast channels, and alternate ad sources normalize deterministically', () => {
  const kyc = transformSourceRow('kyc_verifications', { id: 'k-1', seller_id: 'seller-1', subject_type: 'seller' });
  assert.equal(kyc[0].data.submission.subjectType, 'STORE');

  const broadcast = transformSourceRow('broadcasts', { id: 'b-1', user_id: 'user-1', channel: 'in-app', body: 'Notice' });
  assert.equal(broadcast[0].data.channel, 'IN_APP');

  const ad = transformSourceRow('ad_campaigns', { id: 'a-1', seller_id: 'seller-1', title: 'Campaign', budget: 100 });
  assert.equal(ad[0].source.table, 'ad_campaigns');
});

test('sourcing migration isolates procurement-only fields from the public request and item', () => {
  const [request, item, procurement] = transformSourceRow('sourcing_requests', {
    id: 'source-1', user_id: 'user-1', product_name: 'Custom cartons', source_url: 'https://supplier.example/item/1',
    supplier_reference: 'private-supplier', source_cost: 200, quantity: 10,
  });
  assert.equal(request.targetEntity, 'SourcingRequest');
  assert.equal(item.targetEntity, 'SourcingItem');
  assert.equal(procurement.targetEntity, 'SourcingProcurement');
  assert.equal(request.data.sourceUrl, undefined);
  assert.equal(request.data.supplierReference, undefined);
  assert.equal(item.data.supplierReference, undefined);
  assert.equal(procurement.data.supplierReference, 'private-supplier');
  assert.equal(procurement.data.confidentiality, 'INTERNAL_ONLY');
});
