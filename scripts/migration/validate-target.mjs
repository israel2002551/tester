#!/usr/bin/env node
import path from 'node:path';
import { parseArgs, printPlan, readJson, resolveWorkPath, writeJson } from './common.mjs';

const args = parseArgs();
const sourceFile = path.resolve(args.inventory || resolveWorkPath(null, ['inventory', 'source-inventory.json']));
const outFile = path.resolve(args.out || resolveWorkPath(null, ['reports', 'migration-report.json']));

if (args.help) {
  console.log(`Usage: node scripts/migration/validate-target.mjs --execute [--inventory PATH] [--out PATH]\n\nRuns read-only count and integrity checks against DATABASE_URL and writes a JSON report.`);
  process.exit(0);
}
if (!args.execute) {
  printPlan('validate-target', { sourceInventory: sourceFile, report: outFile, targetQueries: 'read-only' });
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for target validation.');

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const source = await readJson(sourceFile, { tables: {} });
const report = { formatVersion: 1, generatedAt: new Date().toISOString(), passed: true, counts: {}, checks: [], warnings: [] };

const comparisons = [
  ['users', 'profiles', () => prisma.user.count()],
  ['stores', 'profiles', () => prisma.store.count()],
  ['products', 'products', () => prisma.product.count()],
  ['orders', 'orders', () => prisma.order.count()],
  ['messages', 'messages', () => prisma.message.count()],
  ['reviews', 'reviews', () => prisma.review.count()],
  ['payouts', 'withdrawals', () => prisma.payoutRequest.count()],
  ['sourcing', 'sourcing_requests', () => prisma.sourcingRequest.count()],
];

try {
  for (const [target, sourceTable, query] of comparisons) {
    const sourceCount = source.tables?.[sourceTable]?.rowCount ?? null;
    const targetCount = await query();
    report.counts[target] = { sourceTable, source: sourceCount, target: targetCount, comparable: sourceCount != null };
    if (sourceCount != null && sourceTable !== 'profiles' && targetCount < sourceCount) {
      report.passed = false;
      report.warnings.push(`${target}: target count is below source count`);
    }
  }
  const checks = await Promise.all([
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "Order" o LEFT JOIN "User" u ON u.id=o."buyerId" WHERE u.id IS NULL'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "OrderItem" i LEFT JOIN "Order" o ON o.id=i."orderId" WHERE o.id IS NULL'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "Product" p LEFT JOIN "Store" s ON s.id=p."storeId" WHERE s.id IS NULL'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "MediaAsset" WHERE access=\'PUBLIC\' AND "publicUrl" IS NULL'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "ProductVariant" WHERE "priceKobo" < 0'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "InventoryItem" WHERE "onHand" < 0 OR reserved < 0 OR reserved > "onHand"'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM (SELECT lower(email) FROM "User" WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1) d'),
    prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM (SELECT slug FROM "Store" GROUP BY slug HAVING count(*) > 1) d'),
  ]);
  const names = ['orders_without_buyer', 'items_without_order', 'products_without_store', 'public_media_without_url', 'negative_prices', 'invalid_inventory', 'duplicate_emails', 'duplicate_store_slugs'];
  checks.forEach((rows, index) => {
    const count = Number(rows?.[0]?.count || 0);
    report.checks.push({ name: names[index], count, passed: count === 0 });
    if (count) report.passed = false;
  });
} finally {
  await prisma.$disconnect();
}

await writeJson(outFile, report);
console.log(`${report.passed ? 'PASS' : 'FAIL'}: ${outFile}`);
if (!report.passed) process.exitCode = 2;
