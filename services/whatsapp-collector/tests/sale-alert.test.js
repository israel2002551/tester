import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminSaleAlert, cleanPhone } from '../sale-alert.js';

const sale = {
  order_id: '6275744a-1111-2222-3333-444455556666',
  product_name: 'Tiny Stud Earrings',
  paid_price: 20600,
  group_name: 'NUIS MARKETPLACE',
  group_jid: '2347060962569-1523646757@g.us',
  source_price: 500,
  delivery_name: 'BUYSELL. STORE',
  delivery_phone: '+2349061484256',
  delivery_address: 'VERIFIED HUB: UNIBEN Ugbowo Gate',
};

test('with the seller\'s number, the alert links to a chat with them', () => {
  const text = buildAdminSaleAlert({ ...sale, seller_phone: '2348031234567' });
  assert.match(text, /Original Seller Phone:\* \+2348031234567/);
  assert.match(text, /https:\/\/wa\.me\/2348031234567/);
  assert.match(text, /Tap the seller link above/);
});

test('a local number is turned into an international one', () => {
  assert.equal(cleanPhone('0803 123 4567'), '2348031234567');
  assert.match(buildAdminSaleAlert({ ...sale, seller_phone: '08031234567' }), /wa\.me\/2348031234567/);
});

test('without a number, there is no broken link, just how to reach the seller', () => {
  const text = buildAdminSaleAlert({ ...sale, seller_phone: '' });
  assert.doesNotMatch(text, /wa\.me/);
  assert.match(text, /WhatsApp hides this seller's number/);
  assert.match(text, /Message the seller in the group above/);
  assert.match(text, /NUIS MARKETPLACE/);
});

test('something too short or long to be a number gets no link', () => {
  assert.equal(cleanPhone('12345'), '');
  assert.equal(cleanPhone('1234567890123456'), '');
  assert.doesNotMatch(buildAdminSaleAlert({ ...sale, seller_phone: '12345' }), /wa\.me/);
});

test('the rest of the alert is unchanged', () => {
  const text = buildAdminSaleAlert({ ...sale, seller_phone: '' });
  for (const part of ['Tiny Stud Earrings', '₦20,600', '#6275744a', '₦500', 'BUYSELL. STORE', '+2349061484256', 'UNIBEN Ugbowo Gate']) {
    assert.ok(text.includes(part), part);
  }
});
