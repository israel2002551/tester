#!/usr/bin/env node
import path from 'node:path';
import {
  appendNdjson,
  fileExists,
  parseArgs,
  printPlan,
  readNdjson,
  resolveWorkPath,
  stableUuid,
  uuidOrStable,
} from './common.mjs';

const args = parseArgs();
const inputDir = resolveWorkPath(args.in, ['transformed']);
const resultFile = path.resolve(args.results || resolveWorkPath(null, ['reports', 'load-manifest.ndjson']));
const confirmed = args.execute && args.confirm === 'IMPORT_TO_TARGET';

if (args.help) {
  console.log(`Usage: node scripts/migration/load-target.mjs --execute --confirm IMPORT_TO_TARGET [--in PATH]\n\nLoads normalized records into DATABASE_URL in dependency order. It performs idempotent upserts and never deletes target rows.`);
  process.exit(0);
}
if (!confirmed) {
  printPlan('load-target', { inputDirectory: inputDir, results: resultFile, targetWrites: true, destructiveStatements: false, requiredConfirmation: 'IMPORT_TO_TARGET' });
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Point it at the verified target database.');

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const bigIntKeys = new Set([
  'shippingFeeKobo', 'priceKobo', 'compareAtKobo', 'subtotalKobo', 'shippingKobo', 'discountKobo',
  'platformFeeKobo', 'totalKobo', 'sellerAmountKobo', 'platformCommissionKobo', 'targetBudgetKobo',
  'quotedUnitKobo', 'sourceUnitCostMinor', 'sourceShippingMinor', 'internationalShippingKobo', 'localDeliveryKobo',
  'budgetKobo', 'spentKobo',
]);
const dateKeys = new Set([
  'createdAt', 'updatedAt', 'publishedAt', 'placedAt', 'paidAt', 'cancelledAt', 'deliveredAt',
  'desiredDeliveryAt', 'submittedAt', 'reviewedAt', 'startsAt', 'endsAt', 'expiresAt', 'consumedAt',
  'availableAt', 'scheduledFor', 'scheduledAt', 'sentAt', 'lastUsedAt',
]);
function nativeData(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (value == null) return [key, null];
    if (bigIntKeys.has(key)) return [key, BigInt(value)];
    if (dateKeys.has(key)) return [key, new Date(value)];
    return [key, value];
  }));
}

async function forEntity(entity, handler) {
  const file = path.join(inputDir, 'entities', `${entity}.ndjson`);
  if (!(await fileExists(file))) return;
  for await (const { value: envelope, lineNumber } of readNdjson(file)) {
    const targetId = envelope.data?.id || envelope.data?.userId || envelope.data?.variantId || null;
    try {
      await handler(nativeData(envelope.data), envelope);
      await appendNdjson(resultFile, [{ sourceTable: envelope.source.table, sourceId: envelope.source.id, targetTable: entity, targetId, status: 'loaded', warnings: [], timestamp: new Date().toISOString() }]);
    } catch (error) {
      await appendNdjson(resultFile, [{ sourceTable: envelope.source.table, sourceId: envelope.source.id, targetTable: entity, targetId, status: 'failed', warnings: [`line ${lineNumber}: ${error.message}`], timestamp: new Date().toISOString() }]);
      if (args.continueOnError !== true) throw error;
    }
  }
}

try {
  await forEntity('User', async (data) => {
    const { legacy: _legacy, ...record } = data;
    await prisma.user.upsert({ where: { id: record.id }, update: { email: record.email, status: record.status }, create: record });
  });
  await forEntity('AuthIdentity', async (data) => {
    const where = { provider_providerSubject: { provider: data.provider, providerSubject: data.providerSubject } };
    await prisma.authIdentity.upsert({ where, update: { userId: data.userId, providerEmail: data.providerEmail }, create: data });
  });
  await forEntity('UserProfile', async (data) => {
    await prisma.userProfile.upsert({ where: { userId: data.userId }, update: data, create: data });
  });
  await forEntity('Store', async (data) => {
    await prisma.store.upsert({ where: { id: data.id }, update: { name: data.name, description: data.description, status: data.status, metadata: data.metadata }, create: data });
  });
  await forEntity('StoreMembership', async (data) => {
    await prisma.storeMembership.upsert({ where: { storeId_userId: { storeId: data.storeId, userId: data.userId } }, update: { role: data.role, status: data.status }, create: data });
  });
  await forEntity('LedgerAccount', async (data) => {
    await prisma.ledgerAccount.upsert({ where: { storeId: data.storeId }, update: { currency: data.currency }, create: data });
  });
  await forEntity('Product', async (data) => {
    const { categoryLegacyId: _categoryLegacyId, ...record } = data;
    await prisma.product.upsert({ where: { id: record.id }, update: { name: record.name, description: record.description, status: record.status, metadata: record.metadata }, create: record });
  });
  await forEntity('ProductVariant', async (data) => {
    await prisma.productVariant.upsert({ where: { id: data.id }, update: { priceKobo: data.priceKobo, compareAtKobo: data.compareAtKobo, active: data.active }, create: data });
  });
  await forEntity('InventoryItem', async (data) => {
    await prisma.inventoryItem.upsert({ where: { variantId: data.variantId }, update: { onHand: data.onHand, reorderPoint: data.reorderPoint }, create: data });
  });
  await forEntity('MediaAsset', async (data, envelope) => {
    const { ownerLegacyId, ...record } = data;
    record.ownerId = uuidOrStable(ownerLegacyId, 'user', ownerLegacyId || envelope?.source?.id);
    await prisma.mediaAsset.upsert({ where: { providerAssetId: record.providerAssetId }, update: { publicUrl: record.publicUrl, metadata: record.metadata }, create: record });
  });
  await forEntity('ProductMedia', async (data) => {
    await prisma.productMedia.upsert({ where: { productId_assetId: { productId: data.productId, assetId: data.assetId } }, update: { sortOrder: data.sortOrder }, create: data });
  });
  await forEntity('SourcingRequest', async (data) => {
    await prisma.sourcingRequest.upsert({ where: { id: data.id }, update: { status: data.status, notes: data.notes, deliveryLocation: data.deliveryLocation }, create: data });
  });
  await forEntity('SourcingItem', async (data) => {
    await prisma.sourcingItem.upsert({ where: { id: data.id }, update: { title: data.title, description: data.description, specifications: data.specifications, quantity: data.quantity, referenceUrl: data.referenceUrl, targetBudgetKobo: data.targetBudgetKobo }, create: data });
  });
  await forEntity('SourcingProcurement', async (data) => {
    const { confidentiality: _confidentiality, ...record } = data;
    await prisma.sourcingProcurement.upsert({ where: { requestId: record.requestId }, update: record, create: record });
  });

  await forEntity('ImportedOrderBundle', async (bundle) => {
    const { order, storeOrder, items } = bundle;
    const buyer = await prisma.user.findUnique({ where: { id: order.buyerId }, select: { id: true } });
    if (!buyer) throw new Error(`Buyer ${order.buyerId} is not loaded.`);
    const store = await prisma.store.findUnique({ where: { id: storeOrder.storeId }, select: { id: true } });
    if (!store) throw new Error(`Store ${storeOrder.storeId} is not loaded.`);
    const addressId = stableUuid('legacy-order-address', order.id);
    const quoteId = stableUuid('legacy-order-quote', order.id);
    const address = order.addressSnapshot || {};
    await prisma.$transaction(async (tx) => {
      await tx.address.upsert({
        where: { id: addressId }, update: {}, create: {
          id: addressId, userId: order.buyerId, recipientName: address.recipientName || 'Legacy customer', phone: address.phone || 'not-provided',
          line1: address.address || 'Legacy delivery address unavailable', city: 'Unknown', state: 'Unknown', country: 'Nigeria',
        },
      });
      const normalizedItems = [];
      for (const item of items) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId }, include: { product: true } });
        if (!variant) throw new Error(`Variant ${item.variantId} is not loaded.`);
        normalizedItems.push({ ...item, productId: variant.productId });
      }
      await tx.checkoutQuote.upsert({
        where: { id: quoteId }, update: {}, create: {
          id: quoteId, userId: order.buyerId, addressId, status: 'CONSUMED', currency: order.currency,
          subtotalKobo: BigInt(order.subtotalKobo), shippingKobo: BigInt(order.shippingKobo), discountKobo: BigInt(order.discountKobo),
          platformFeeKobo: BigInt(order.platformFeeKobo), totalKobo: BigInt(order.totalKobo), deliveryMethod: order.deliveryMethod,
          pricingVersion: 'legacy-import-v1', expiresAt: new Date(order.placedAt), consumedAt: new Date(order.placedAt),
          items: { create: normalizedItems.map((item) => ({
            variantId: item.variantId, storeId: storeOrder.storeId, productName: item.productName, variantName: item.variantName,
            sku: item.sku, unitPriceKobo: BigInt(item.unitPriceKobo), shippingUnitKobo: BigInt(item.shippingUnitKobo), quantity: item.quantity,
          })) },
        },
      });
      const existing = await tx.order.findUnique({ where: { id: order.id }, select: { id: true } });
      if (existing) return;
      const commission = BigInt(order.platformFeeKobo || 0);
      const subtotal = BigInt(order.subtotalKobo);
      await tx.order.create({
        data: {
          ...nativeData((({ migrationMetadata: _migrationMetadata, ...record }) => ({ ...record, quoteId }))(order)),
          storeOrders: { create: [{
            id: storeOrder.id, storeId: storeOrder.storeId, status: storeOrder.status,
            subtotalKobo: subtotal, shippingKobo: BigInt(order.shippingKobo), discountKobo: BigInt(order.discountKobo),
            platformFeeKobo: BigInt(order.platformFeeKobo), commissionKobo: commission, sellerNetKobo: subtotal - commission,
            totalKobo: BigInt(storeOrder.totalKobo),
            items: { create: normalizedItems.map((item) => ({
              id: item.id, orderId: order.id, variantId: item.variantId, productId: item.productId,
              productName: item.productName, variantName: item.variantName, sku: item.sku,
              unitPriceKobo: BigInt(item.unitPriceKobo), shippingUnitKobo: BigInt(item.shippingUnitKobo), quantity: item.quantity,
              totalKobo: BigInt(item.totalKobo), sellerAmountKobo: BigInt(item.totalKobo), platformCommissionKobo: 0n,
            })) },
          }] },
          events: { create: { toStatus: order.status, note: 'Imported from the legacy marketplace.' } },
        },
      });
    }, { isolationLevel: 'Serializable' });
  });

  await forEntity('MessageBundle', async (bundle) => {
    const { conversation, members, message } = bundle;
    const existingUsers = await prisma.user.findMany({ where: { id: { in: members } }, select: { id: true } });
    if (!existingUsers.some((user) => user.id === message.senderId)) throw new Error(`Message sender ${message.senderId} is not loaded.`);
    await prisma.conversation.upsert({
      where: { id: conversation.id }, update: {}, create: { id: conversation.id, type: conversation.type,
        members: { create: existingUsers.map((user) => ({ userId: user.id })) } },
    });
    await prisma.message.upsert({ where: { id: message.id }, update: {}, create: { ...message, createdAt: new Date(message.createdAt) } });
  });

  await forEntity('Review', async (data) => {
    const { orderId, ...record } = data;
    if (!record.orderItemId && orderId) {
      const item = await prisma.orderItem.findFirst({ where: { orderId, productId: record.productId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      record.orderItemId = item?.id || null;
    }
    if (!record.orderItemId) throw new Error('Review has no resolvable order item and requires manual mapping.');
    await prisma.review.upsert({ where: { id: record.id }, update: { body: record.body, rating: record.rating, status: record.status }, create: record });
  });
  await forEntity('ImportedKycBundle', async (bundle) => {
    const submission = nativeData(bundle.submission);
    await prisma.kycSubmission.upsert({
      where: { id: submission.id },
      update: { status: submission.status, reviewedAt: submission.reviewedAt, decisionReason: submission.decisionReason },
      create: submission,
    });
  });
  await forEntity('AdCampaign', async (data) => {
    const { spentKobo: _spentKobo, ...record } = data;
    await prisma.adCampaign.upsert({
      where: { id: record.id },
      update: { name: record.name, headline: record.headline, body: record.body, status: record.status, budgetKobo: record.budgetKobo },
      create: record,
    });
  });
  await forEntity('OrderStatusEvent', async (data) => {
    await prisma.orderStatusEvent.upsert({ where: { id: data.id }, update: { note: data.note, metadata: data.metadata }, create: data });
  });
  await forEntity('LedgerEntry', async (data) => {
    await prisma.ledgerEntry.upsert({ where: { idempotencyKey: data.idempotencyKey }, update: { description: data.description, metadata: data.metadata }, create: data });
  });
  await forEntity('Dispute', async (data) => {
    await prisma.dispute.upsert({ where: { id: data.id }, update: { status: data.status, resolution: data.resolution }, create: data });
  });
  await forEntity('ServiceListing', async (data) => {
    await prisma.serviceListing.upsert({ where: { id: data.id }, update: { title: data.title, description: data.description, active: data.active, metadata: data.metadata }, create: data });
  });
  await forEntity('ServiceBooking', async (data) => {
    await prisma.serviceBooking.upsert({ where: { id: data.id }, update: { status: data.status, notes: data.notes }, create: data });
  });
  await forEntity('FulfilmentHub', async (data) => {
    await prisma.fulfilmentHub.upsert({ where: { id: data.id }, update: { name: data.name, address: data.address, active: data.active }, create: data });
  });
  await forEntity('PushSubscription', async (data) => {
    await prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId: data.userId, endpoint: data.endpoint } },
      update: { p256dh: data.p256dh, auth: data.auth, deviceMeta: data.deviceMeta, lastUsedAt: data.lastUsedAt }, create: data,
    });
  });
  await forEntity('BroadcastCampaign', async (data) => {
    await prisma.broadcastCampaign.upsert({ where: { id: data.id }, update: { subject: data.subject, content: data.content, status: data.status }, create: data });
  });

  const markReviewOnly = async (entity, reason) => {
    const file = path.join(inputDir, 'entities', `${entity}.ndjson`);
    if (!(await fileExists(file))) return;
    for await (const { value: envelope } of readNdjson(file)) {
      await appendNdjson(resultFile, [{
        sourceTable: envelope.source.table, sourceId: envelope.source.id, targetTable: entity,
        targetId: envelope.data?.id || null, status: 'needs_review', warnings: [reason], timestamp: new Date().toISOString(),
      }]);
    }
  };
  await markReviewOnly('ImportedPayoutBundle', 'Create and verify an encrypted payout destination before importing this historical payout.');
  await markReviewOnly('LegacyReviewQueue', 'No lossless automatic mapping exists for this legacy record; review the source payload and map it explicitly.');
} finally {
  await prisma.$disconnect();
}

console.log(`Target load completed. Per-record results: ${resultFile}`);
