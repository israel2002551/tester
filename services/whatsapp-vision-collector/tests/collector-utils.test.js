import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractNairaPriceCandidates,
  hasPriceInText,
  looksLikeSalePost,
  normalizeWhatsAppPhoneNumber,
  parseNairaAmount,
  parseTextLocally,
  stripPriceFromText,
} from '../parser.js';
import { KeyedTaskQueue } from '../queue.js';

test('normalizes common Nigerian price formats', () => {
  const cases = [
    ['Ladies top 5,500', 5_500],
    ['₦5,500', 5_500],
    ['N5500', 5_500],
    ['#5,500', 5_500],
    ['#45k', 45_000],
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
  assert.equal(hasPriceInText('#45k'), true);
  assert.equal(hasPriceInText('10 Oct 2026', { mediaContext: true }), false);
  assert.equal(hasPriceInText('Call 08035501234', { mediaContext: true }), false);
  assert.equal(extractNairaPriceCandidates('Ladies top 5,500', { mediaContext: true })[0].amount, 5_500);
  assert.equal(extractNairaPriceCandidates('#150,000')[0].amount, 150_000);
  assert.equal(stripPriceFromText('Ladies top ₦5,500').includes('5,500'), false);
  assert.equal(stripPriceFromText('Bag #45,000').includes('45,000'), false);
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

test('looksLikeSalePost accepts all media posts, commercial text, and rejects pure greetings', () => {
  // Media posts in group are always accepted
  assert.equal(looksLikeSalePost('Clean drip', true), true);
  assert.equal(looksLikeSalePost('', true), true);
  assert.equal(looksLikeSalePost('iPhone 12 Pro Max 128gb battery 85%', true), true);

  // Text-only posts with prices, specs, or product names
  assert.equal(looksLikeSalePost('Clean iPhone 12 Pro Max 128gb battery 85% 280k', false), true);
  assert.equal(looksLikeSalePost('HP Elitebook 840 G5 16gb ram 512gb ssd', false), true);
  assert.equal(looksLikeSalePost('Nike sneakers size 43 available', false), true);
  assert.equal(looksLikeSalePost('Toyota Corolla 2012 model buy and drive', false), true);
  assert.equal(looksLikeSalePost('#45k', false), true);

  // Pure conversational greetings or admin reports are rejected
  assert.equal(looksLikeSalePost('Good morning admin', false), false);
  assert.equal(looksLikeSalePost('Happy Sunday', false), false);
  assert.equal(looksLikeSalePost('Amen', false), false);
  assert.equal(looksLikeSalePost('Scam alert', false), false);
});

test('sharp compresses and resizes high-resolution image buffers to save bandwidth', async () => {
  const sharp = (await import('sharp')).default;
  // Create an uncompressed 2000x2000 raw image
  const rawImage = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: { r: 255, g: 100, b: 50 },
    },
  }).png().toBuffer();

  const compressed = await sharp(rawImage)
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75, progressive: true, mozjpeg: true })
    .toBuffer();

  assert.ok(compressed.length < rawImage.length, 'Compressed image must be smaller than raw PNG');
  assert.ok(compressed.length < 500_000, 'Compressed image must be well under 500KB');

  const metadata = await sharp(compressed).metadata();
  assert.ok(metadata.width <= 1280, 'Width must be <= 1280');
  assert.ok(metadata.height <= 1280, 'Height must be <= 1280');
});

test('zlib compresses JSON payloads with Brotli and Gzip', async () => {
  const zlib = (await import('node:zlib')).default;
  const largeJson = JSON.stringify({ items: Array(100).fill({ name: 'iPhone 15 Pro', price: 950000, status: 'active' }) });
  const rawBytes = Buffer.from(largeJson, 'utf-8');

  const gzipped = zlib.gzipSync(rawBytes);
  const brotlied = zlib.brotliCompressSync(rawBytes);

  assert.ok(gzipped.length < rawBytes.length, 'Gzip must compress large JSON');
  assert.ok(brotlied.length < rawBytes.length, 'Brotli must compress large JSON');
});

test('normalizeWhatsAppPhoneNumber converts domestic and formatted Nigerian phone numbers', () => {
  assert.equal(normalizeWhatsAppPhoneNumber('09061484256'), '2349061484256');
  assert.equal(normalizeWhatsAppPhoneNumber('08080302256'), '2348080302256');
  assert.equal(normalizeWhatsAppPhoneNumber('+234 906 148 4256'), '2349061484256');
  assert.equal(normalizeWhatsAppPhoneNumber('2349061484256'), '2349061484256');
  assert.equal(normalizeWhatsAppPhoneNumber('9061484256'), '2349061484256');
  assert.equal(normalizeWhatsAppPhoneNumber(''), '');
  assert.equal(normalizeWhatsAppPhoneNumber(null), '');
});

test('parseTextLocally extracts product, price, category, and specs without external AI', () => {
  const single = parseTextLocally('Samsung S21 ultra  128 gb  350k');
  assert.ok(single);
  assert.equal(single.is_commercial_listing, true);
  assert.equal(single.items.length, 1);
  assert.equal(single.items[0].title, 'Samsung S21 ultra 128 gb');
  assert.equal(single.items[0].price, 350_000);
  assert.equal(single.items[0].category, 'Phones & Tablets');
  assert.equal(single.items[0].brand, 'Samsung');
  assert.equal(single.items[0].specs, '128 gb');

  const multi = parseTextLocally('iPhone 11 64gb - 210k\niPhone 12 128gb - 320k');
  assert.ok(multi);
  assert.equal(multi.items.length, 2);
  assert.equal(multi.items[0].price, 210_000);
  assert.equal(multi.items[1].price, 320_000);
});
