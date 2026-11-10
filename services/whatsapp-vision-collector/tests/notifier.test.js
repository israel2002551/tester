import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogLink, sendSellerBatchConfirmation, sendSellerConfirmation } from '../notifier.js';

const SITE = 'https://www.buysell-marketplace.com';
const catalog = { catalog_token: 'Ab-c_123456789012345678901234', catalog_url: 'https://elsewhere.example/manage?catalog=x' };

function fakeSock() {
  const sent = [];
  return {
    sent,
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, message) => { sent.push({ jid, text: message.text }); },
  };
}

const links = text => text.match(/https?:\/\/\S+/g) || [];
const listing = (id, name, price) => ({ product_id: id, product: { name, price }, public_url: `${SITE}/product?id=${id}` });

test('one item: the message carries only the seller\'s catalog link', async () => {
  const sock = fakeSock();
  await sendSellerConfirmation(sock, {
    senderJid: '2348012345678',
    listing: listing('p1', 'Gown', 12000),
    manageToken: 'item-token',
    catalog,
    publicSiteUrl: SITE,
  });
  const { jid, text } = sock.sent[0];
  assert.equal(jid, '2348012345678@s.whatsapp.net');
  assert.deepEqual(links(text), [`${SITE}/manage?catalog=Ab-c_123456789012345678901234`]);
  assert.match(text, /\*Item:\* Gown/);
  assert.match(text, /₦12,000/);
  assert.match(text, /same link every time/);
});

test('several items: listed by name and price, with one link for all of them', async () => {
  const sock = fakeSock();
  await sendSellerBatchConfirmation(sock, {
    senderJid: '12345@lid',
    listings: [
      { listing: listing('p1', 'Gown', 12000), manageToken: 't1' },
      { listing: listing('p2', 'Handbag', 8400), manageToken: 't2' },
      { listing: listing('p3', 'Heels', 15600), manageToken: 't3' },
    ],
    catalog,
    publicSiteUrl: SITE,
  });
  const { jid, text } = sock.sent[0];
  assert.equal(jid, '12345@lid');
  assert.match(text, /3 items were received by BUYSELL/);
  for (const name of ['Gown', 'Handbag', 'Heels']) assert.match(text, new RegExp(`\\*${name}\\*`));
  assert.deepEqual(links(text), [`${SITE}/manage?catalog=Ab-c_123456789012345678901234`]);
});

test('without a catalog link, each item keeps its own links as before', async () => {
  const sock = fakeSock();
  await sendSellerConfirmation(sock, {
    senderJid: '2348012345678',
    listing: listing('p1', 'Gown', 12000),
    manageToken: 'item-token',
    catalog: null,
    publicSiteUrl: SITE,
  });
  assert.deepEqual(links(sock.sent[0].text), [
    `${SITE}/manage?product=p1&token=item-token`,
    `${SITE}/product?id=p1`,
  ]);
});

test('the link uses the bot\'s site address, or the one BUYSELL returned when the bot has none', () => {
  const saved = process.env.PUBLIC_SITE_URL;
  delete process.env.PUBLIC_SITE_URL;
  try {
    assert.equal(catalogLink(catalog, SITE), `${SITE}/manage?catalog=Ab-c_123456789012345678901234`);
    assert.equal(catalogLink(catalog, ''), catalog.catalog_url);
    assert.equal(catalogLink(null, SITE), '');
  } finally {
    if (saved !== undefined) process.env.PUBLIC_SITE_URL = saved;
  }
});
