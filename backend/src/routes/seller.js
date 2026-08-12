import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { requireStorePermission } from '../auth/permissions.js';
import { assertTeamMutation } from '../auth/permissions.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { asyncRoute, created, pageMeta, pagination, success } from '../lib/http.js';
import { slugify } from '../lib/ids.js';
import { cleanText, moneyString, uuid } from '../lib/validation.js';
import { assertTransition } from '../lib/transitions.js';
import { validate } from '../middleware/validate.js';
import { accountFingerprint, ledgerBalance, protectAccountNumber, requestPayout } from '../services/finance.js';
import { advanceParentOrder } from '../services/orders.js';

const storeSchema = z.object({ name: cleanText(120), slug: z.string().trim().regex(/^[a-z0-9-]{3,72}$/).optional(), description: z.string().trim().max(3000).optional(), supportEmail: z.string().email().optional(), supportPhone: z.string().trim().max(30).optional(), location: z.string().trim().max(160).optional() });
const productSchema = z.object({
  name: cleanText(180), slug: z.string().trim().regex(/^[a-z0-9-]{2,72}$/).optional(), description: z.string().trim().max(20_000).optional(),
  categoryId: uuid.optional().nullable(), brandId: uuid.optional().nullable(), condition: z.enum(['NEW', 'USED', 'REFURBISHED']).default('NEW'),
  shippingFeeKobo: moneyString.default(0), negotiable: z.boolean().default(false),
  variants: z.array(z.object({ sku: cleanText(80), name: z.string().trim().max(120).optional(), priceKobo: moneyString, compareAtKobo: moneyString.optional().nullable(), attributes: z.record(z.string(), z.unknown()).optional(), onHand: z.number().int().nonnegative().default(0), reorderPoint: z.number().int().nonnegative().default(0) })).min(1).max(100),
  mediaAssetIds: z.array(uuid).max(12).default([]),
});

export function createSellerRouter() {
  const router = Router();
  router.use(...requireAuth());
  router.get('/stores', asyncRoute(async (req, res) => success(res, req.user.storeMemberships.map((membership) => ({ ...membership.store, role: membership.role, permissions: membership.permissions })))));
  router.post('/onboarding/store', validate(storeSchema), asyncRoute(async (req, res) => {
    const slug = req.body.slug || slugify(req.body.name);
    if (!slug) throw badRequest('INVALID_STORE_SLUG', 'Choose a store name that can form a valid URL.');
    const store = await req.db.$transaction(async (tx) => {
      const createdStore = await tx.store.create({ data: { ownerId: req.user.id, slug, name: req.body.name, description: req.body.description, supportEmail: req.body.supportEmail, supportPhone: req.body.supportPhone, location: req.body.location } });
      await tx.storeMembership.create({ data: { storeId: createdStore.id, userId: req.user.id, role: 'OWNER' } });
      await tx.storeSetting.create({ data: { storeId: createdStore.id } });
      await tx.ledgerAccount.create({ data: { storeId: createdStore.id } });
      await tx.outboxEvent.create({ data: { topic: 'store.onboarding_started', aggregateId: createdStore.id, payload: { storeId: createdStore.id, ownerId: req.user.id } } });
      return createdStore;
    });
    return created(res, store);
  }));
  router.get('/:storeId', requireStorePermission('STORE_READ'), asyncRoute(async (req, res) => {
    const store = await req.db.store.findUnique({ where: { id: req.params.storeId }, include: { logo: true, banner: true, settings: true } });
    if (!store) throw notFound('Store');
    return success(res, store);
  }));
  router.patch('/:storeId', requireStorePermission('STORE_UPDATE'), validate(storeSchema.partial().extend({ logoAssetId: uuid.optional().nullable(), bannerAssetId: uuid.optional().nullable() })), asyncRoute(async (req, res) => {
    for (const assetId of [req.body.logoAssetId, req.body.bannerAssetId].filter(Boolean)) {
      const asset = await req.db.mediaAsset.findFirst({ where: { id: assetId, ownerId: req.user.id, access: 'PUBLIC', kind: 'IMAGE' } });
      if (!asset) throw badRequest('INVALID_STORE_MEDIA', 'Store branding must use public images you uploaded.');
    }
    return success(res, await req.db.store.update({ where: { id: req.params.storeId }, data: req.body }));
  }));
  router.get('/:storeId/dashboard', requireStorePermission('STORE_READ'), asyncRoute(async (req, res) => {
    const [productCount, pendingOrders, revenue, lowStock] = await Promise.all([
      req.db.product.count({ where: { storeId: req.params.storeId, deletedAt: null } }),
      req.db.storeOrder.count({ where: { storeId: req.params.storeId, status: { in: ['PAID', 'PROCESSING', 'READY'] } } }),
      req.db.storeOrder.aggregate({ where: { storeId: req.params.storeId, status: { in: ['PAID', 'PROCESSING', 'READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] } }, _sum: { sellerNetKobo: true } }),
      req.db.inventoryItem.count({ where: { variant: { product: { storeId: req.params.storeId, deletedAt: null } }, onHand: { lte: 5 } } }),
    ]);
    return success(res, { productCount, pendingOrders, revenueKobo: revenue._sum.sellerNetKobo || 0n, lowStock });
  }));
  router.get('/:storeId/products', requireStorePermission('PRODUCT_READ'), asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const where = { storeId: req.params.storeId, deletedAt: null, ...(req.query.status ? { status: req.query.status } : {}) };
    const [products, total] = await Promise.all([
      req.db.product.findMany({ where, include: { variants: { include: { inventory: true } }, media: { include: { asset: true }, orderBy: { sortOrder: 'asc' } }, category: true, brand: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.product.count({ where }),
    ]);
    return success(res, products, pageMeta(page.page, page.limit, total));
  }));
  router.get('/:storeId/products/:productId', requireStorePermission('PRODUCT_READ'), asyncRoute(async (req, res) => {
    const product = await req.db.product.findFirst({ where: { id: req.params.productId, storeId: req.params.storeId, deletedAt: null }, include: { variants: { include: { inventory: true, optionValues: { include: { value: { include: { option: true } } } } } }, options: { include: { values: true } }, media: { include: { asset: true }, orderBy: { sortOrder: 'asc' } }, category: true, brand: true } });
    if (!product) throw notFound('Product');
    return success(res, product);
  }));
  router.post('/:storeId/products', requireStorePermission('PRODUCT_WRITE'), validate(productSchema), asyncRoute(async (req, res) => {
    if (req.body.mediaAssetIds.length) {
      const count = await req.db.mediaAsset.count({ where: { id: { in: req.body.mediaAssetIds }, ownerId: req.user.id, access: 'PUBLIC', kind: { in: ['IMAGE', 'VIDEO'] } } });
      if (count !== req.body.mediaAssetIds.length) throw badRequest('INVALID_PRODUCT_MEDIA', 'Every product asset must be a public image or video you uploaded.');
    }
    const product = await req.db.product.create({
      data: {
        storeId: req.params.storeId, name: req.body.name, slug: req.body.slug || slugify(req.body.name), description: req.body.description,
        categoryId: req.body.categoryId, brandId: req.body.brandId, condition: req.body.condition,
        shippingFeeKobo: BigInt(req.body.shippingFeeKobo), negotiable: req.body.negotiable, status: 'DRAFT',
        variants: { create: req.body.variants.map((variant) => ({ sku: variant.sku, name: variant.name, priceKobo: BigInt(variant.priceKobo), compareAtKobo: variant.compareAtKobo === null || variant.compareAtKobo === undefined ? null : BigInt(variant.compareAtKobo), attributes: variant.attributes || {}, inventory: { create: { onHand: variant.onHand, reorderPoint: variant.reorderPoint } } })) },
        media: { create: req.body.mediaAssetIds.map((assetId, sortOrder) => ({ assetId, sortOrder })) },
      },
      include: { variants: { include: { inventory: true } }, media: { include: { asset: true } } },
    });
    return created(res, product);
  }));
  router.patch('/:storeId/products/:productId', requireStorePermission('PRODUCT_WRITE'), validate(z.object({ name: cleanText(180).optional(), description: z.string().trim().max(20_000).optional().nullable(), categoryId: uuid.optional().nullable(), brandId: uuid.optional().nullable(), condition: z.enum(['NEW', 'USED', 'REFURBISHED']).optional(), shippingFeeKobo: moneyString.optional(), negotiable: z.boolean().optional(), status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional() })), asyncRoute(async (req, res) => {
    const product = await req.db.product.findFirst({ where: { id: req.params.productId, storeId: req.params.storeId, deletedAt: null } });
    if (!product) throw notFound('Product');
    if (req.body.status === 'ACTIVE' && !['ACTIVE', 'PAUSED', 'OUT_OF_STOCK'].includes(product.status)) throw conflict('PRODUCT_REVIEW_REQUIRED', 'New or rejected products require platform review before publication.');
    const data = { ...req.body, ...(req.body.shippingFeeKobo !== undefined ? { shippingFeeKobo: BigInt(req.body.shippingFeeKobo) } : {}) };
    return success(res, await req.db.product.update({ where: { id: product.id }, data }));
  }));
  router.patch('/:storeId/products/:productId/variants/:variantId', requireStorePermission('PRODUCT_WRITE'), validate(z.object({ sku: cleanText(80).optional(), name: z.string().trim().max(120).optional().nullable(), priceKobo: moneyString.optional(), compareAtKobo: moneyString.optional().nullable(), attributes: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional() })), asyncRoute(async (req, res) => {
    const variant = await req.db.productVariant.findFirst({ where: { id: req.params.variantId, productId: req.params.productId, product: { storeId: req.params.storeId, deletedAt: null } } });
    if (!variant) throw notFound('Product variant');
    const priceKobo = req.body.priceKobo === undefined ? variant.priceKobo : BigInt(req.body.priceKobo);
    const compareAtKobo = req.body.compareAtKobo === undefined ? variant.compareAtKobo : req.body.compareAtKobo === null ? null : BigInt(req.body.compareAtKobo);
    if (compareAtKobo !== null && compareAtKobo <= priceKobo) throw badRequest('INVALID_COMPARE_PRICE', 'Compare-at price must be greater than the selling price.');
    const data = { ...req.body, ...(req.body.priceKobo !== undefined ? { priceKobo } : {}), ...(req.body.compareAtKobo !== undefined ? { compareAtKobo } : {}) };
    return success(res, await req.db.productVariant.update({ where: { id: variant.id }, data, include: { inventory: true, optionValues: { include: { value: { include: { option: true } } } } } }));
  }));
  router.delete('/:storeId/products/:productId', requireStorePermission('PRODUCT_WRITE'), asyncRoute(async (req, res) => {
    const changed = await req.db.product.updateMany({ where: { id: req.params.productId, storeId: req.params.storeId, deletedAt: null }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    if (!changed.count) throw notFound('Product');
    return success(res, { deleted: true });
  }));
  router.patch('/:storeId/inventory/:variantId', requireStorePermission('INVENTORY_WRITE'), validate(z.object({ onHand: z.number().int().nonnegative(), reorderPoint: z.number().int().nonnegative().optional(), note: cleanText(500) })), asyncRoute(async (req, res) => {
    const result = await req.db.$transaction(async (tx) => {
      const inventory = await tx.inventoryItem.findFirst({ where: { variantId: req.params.variantId, variant: { product: { storeId: req.params.storeId } } } });
      if (!inventory) throw notFound('Inventory item');
      if (req.body.onHand < inventory.reserved) throw conflict('BELOW_RESERVED_STOCK', 'On-hand stock cannot be set below units reserved for open orders.');
      const delta = req.body.onHand - inventory.onHand;
      const updated = await tx.inventoryItem.update({ where: { variantId: inventory.variantId }, data: { onHand: req.body.onHand, reorderPoint: req.body.reorderPoint, version: { increment: 1 } } });
      await tx.inventoryMovement.create({ data: { inventoryId: inventory.variantId, type: 'ADJUSTMENT', onHandDelta: delta, actorId: req.user.id, note: req.body.note } });
      return updated;
    });
    return success(res, result);
  }));
  router.get('/:storeId/inventory', requireStorePermission('PRODUCT_READ'), asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const where = { variant: { product: { storeId: req.params.storeId, deletedAt: null } }, ...(req.query.low === 'true' ? { onHand: { lte: 5 } } : {}) };
    const [items, total] = await Promise.all([req.db.inventoryItem.findMany({ where, include: { variant: { include: { product: { select: { id: true, name: true, slug: true, status: true } } } } }, orderBy: { updatedAt: 'desc' }, skip: page.skip, take: page.limit }), req.db.inventoryItem.count({ where })]);
    return success(res, items, pageMeta(page.page, page.limit, total));
  }));
  router.get('/:storeId/orders', requireStorePermission('ORDER_READ'), asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const where = { storeId: req.params.storeId, ...(req.query.status ? { status: req.query.status } : {}) };
    const [orders, total] = await Promise.all([
      req.db.storeOrder.findMany({ where, include: { items: true, order: { select: { orderNumber: true, addressSnapshot: true, buyerId: true, paymentStatus: true } }, delivery: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.storeOrder.count({ where }),
    ]);
    return success(res, orders, pageMeta(page.page, page.limit, total));
  }));
  router.patch('/:storeId/orders/:storeOrderId/status', requireStorePermission('ORDER_FULFIL'), validate(z.object({ status: z.enum(['PROCESSING', 'READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']), note: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => {
    const updated = await req.db.$transaction(async (tx) => {
      const storeOrder = await tx.storeOrder.findFirst({ where: { id: req.params.storeOrderId, storeId: req.params.storeId }, include: { order: true } });
      if (!storeOrder) throw notFound('Store order');
      assertTransition('order', storeOrder.status, req.body.status);
      const changed = await tx.storeOrder.update({ where: { id: storeOrder.id }, data: { status: req.body.status, trackingNote: req.body.note } });
      const siblings = await tx.storeOrder.findMany({ where: { orderId: storeOrder.orderId } });
      await advanceParentOrder(tx, storeOrder.order, siblings.map((item) => item.id === changed.id ? changed.status : item.status), req.user.id, req.body.note);
      return changed;
    });
    return success(res, updated);
  }));
  router.get('/:storeId/analytics', requireStorePermission('STORE_READ'), asyncRoute(async (req, res) => {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 86_400_000);
    if (Number.isNaN(since.valueOf())) throw badRequest('INVALID_DATE', 'since must be an ISO date.');
    const [orders, revenue, products] = await Promise.all([
      req.db.storeOrder.groupBy({ by: ['status'], where: { storeId: req.params.storeId, createdAt: { gte: since } }, _count: true }),
      req.db.storeOrder.aggregate({ where: { storeId: req.params.storeId, createdAt: { gte: since }, status: { notIn: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'CANCELLED', 'REFUNDED'] } }, _sum: { totalKobo: true, sellerNetKobo: true }, _count: true }),
      req.db.product.count({ where: { storeId: req.params.storeId, status: 'ACTIVE', deletedAt: null } }),
    ]);
    return success(res, { since, ordersByStatus: orders, revenue, activeProducts: products });
  }));
  router.get('/:storeId/customers', requireStorePermission('CUSTOMER_READ'), asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const grouped = await req.db.storeOrder.groupBy({ by: ['orderId'], where: { storeId: req.params.storeId, status: { not: 'CANCELLED' } }, _sum: { totalKobo: true }, _count: true, orderBy: { _sum: { totalKobo: 'desc' } }, skip: page.skip, take: page.limit });
    const orders = await req.db.order.findMany({ where: { id: { in: grouped.map((item) => item.orderId) } }, select: { id: true, buyer: { select: { id: true, email: true, profile: { select: { displayName: true, phone: true, location: true } } } }, createdAt: true } });
    return success(res, grouped.map((group) => ({ orderId: group.orderId, orderCount: group._count, spendKobo: group._sum.totalKobo || 0n, buyer: orders.find((order) => order.id === group.orderId)?.buyer || null })), { page: page.page, limit: page.limit });
  }));
  router.get('/:storeId/finance', requireStorePermission('FINANCE_READ'), asyncRoute(async (req, res) => {
    const balance = await ledgerBalance(req.db, req.params.storeId);
    const entries = balance.account ? await req.db.ledgerEntry.findMany({ where: { accountId: balance.account.id }, orderBy: { createdAt: 'desc' }, take: 100 }) : [];
    const payouts = balance.account ? await req.db.payoutRequest.findMany({ where: { accountId: balance.account.id }, include: { destination: { select: { id: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true } } }, orderBy: { createdAt: 'desc' } }) : [];
    return success(res, { ...balance, entries, payouts });
  }));
  router.get('/:storeId/payout-destinations', requireStorePermission('FINANCE_READ'), asyncRoute(async (req, res) => success(res, await req.db.payoutDestination.findMany({ where: { storeId: req.params.storeId, active: true }, select: { id: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true, createdAt: true } }))));
  router.get('/:storeId/payouts', requireStorePermission('FINANCE_READ'), asyncRoute(async (req, res) => {
    const account = await req.db.ledgerAccount.findUnique({ where: { storeId: req.params.storeId } });
    return success(res, account ? await req.db.payoutRequest.findMany({ where: { accountId: account.id }, include: { destination: { select: { id: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true } }, transactions: true }, orderBy: { createdAt: 'desc' } }) : []);
  }));
  router.post('/:storeId/payout-destinations', requireStorePermission('PAYOUT_REQUEST'), validate(z.object({ bankCode: z.string().trim().min(2).max(20), accountNumber: z.string().regex(/^\d{8,20}$/), accountName: cleanText(160) })), asyncRoute(async (req, res) => {
    const destination = await req.db.payoutDestination.create({ data: { storeId: req.params.storeId, bankCode: req.body.bankCode, accountNumberEnc: protectAccountNumber(req.body.accountNumber), accountName: req.body.accountName, fingerprint: accountFingerprint(req.body.bankCode, req.body.accountNumber) }, select: { id: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true, createdAt: true } });
    return created(res, destination);
  }));
  router.post('/:storeId/payouts', requireStorePermission('PAYOUT_REQUEST'), validate(z.object({ destinationId: uuid, amountKobo: moneyString })), asyncRoute(async (req, res) => created(res, await requestPayout(req.db, req.user.id, req.params.storeId, req.body.destinationId, req.body.amountKobo))));
  router.get('/:storeId/team', requireStorePermission('STAFF_MANAGE'), asyncRoute(async (req, res) => success(res, await req.db.storeMembership.findMany({ where: { storeId: req.params.storeId }, include: { user: { include: { profile: true } }, permissions: true }, orderBy: { joinedAt: 'asc' } }))));
  router.post('/:storeId/team', requireStorePermission('STAFF_MANAGE'), validate(z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'MANAGER', 'PRODUCT_MANAGER', 'ORDER_MANAGER', 'FINANCE_MANAGER', 'SUPPORT_AGENT']), permissions: z.array(z.enum(['STORE_READ', 'STORE_UPDATE', 'PRODUCT_READ', 'PRODUCT_WRITE', 'INVENTORY_WRITE', 'ORDER_READ', 'ORDER_FULFIL', 'CUSTOMER_READ', 'MESSAGE_WRITE', 'FINANCE_READ', 'PAYOUT_REQUEST', 'STAFF_MANAGE', 'AD_MANAGE'])).default([]) })), asyncRoute(async (req, res) => {
    const user = await req.db.user.findUnique({ where: { email: req.body.email } });
    if (!user) throw notFound('User with that email');
    const target = await req.db.storeMembership.findUnique({ where: { storeId_userId: { storeId: req.params.storeId, userId: user.id } } });
    assertTeamMutation(req.storeMembership, target, req.body.role, req.body.permissions);
    const membership = await req.db.storeMembership.upsert({ where: { storeId_userId: { storeId: req.params.storeId, userId: user.id } }, update: { role: req.body.role, status: 'ACTIVE', permissions: { deleteMany: {}, create: req.body.permissions.map((permission) => ({ permission })) } }, create: { storeId: req.params.storeId, userId: user.id, role: req.body.role, permissions: { create: req.body.permissions.map((permission) => ({ permission })) } }, include: { permissions: true } });
    return created(res, membership);
  }));
  router.delete('/:storeId/team/:membershipId', requireStorePermission('STAFF_MANAGE'), asyncRoute(async (req, res) => {
    const membership = await req.db.storeMembership.findFirst({ where: { id: req.params.membershipId, storeId: req.params.storeId } });
    if (!membership) throw notFound('Team member');
    assertTeamMutation(req.storeMembership, membership, membership.role, []);
    await req.db.storeMembership.update({ where: { id: membership.id }, data: { status: 'INACTIVE' } });
    return success(res, { removed: true });
  }));
  router.get('/:storeId/ads', requireStorePermission('AD_MANAGE'), asyncRoute(async (req, res) => success(res, await req.db.adCampaign.findMany({ where: { storeId: req.params.storeId }, include: { mediaAsset: true }, orderBy: { createdAt: 'desc' } }))));
  router.post('/:storeId/ads', requireStorePermission('AD_MANAGE'), validate(z.object({ name: cleanText(120), placement: cleanText(60), headline: cleanText(180), body: z.string().trim().max(500).optional(), destinationUrl: z.string().url().max(2048), mediaAssetId: uuid.optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), budgetKobo: moneyString })), asyncRoute(async (req, res) => created(res, await req.db.adCampaign.create({ data: { storeId: req.params.storeId, ...req.body, budgetKobo: BigInt(req.body.budgetKobo), status: 'DRAFT' } }))));
  router.get('/:storeId/settings', requireStorePermission('STORE_READ'), asyncRoute(async (req, res) => success(res, await req.db.storeSetting.findUnique({ where: { storeId: req.params.storeId } }))));
  router.put('/:storeId/settings', requireStorePermission('STORE_UPDATE'), validate(z.object({ notificationPreferences: z.record(z.string(), z.unknown()).optional(), commerceSettings: z.record(z.string(), z.unknown()).optional(), fulfilmentSettings: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (req, res) => success(res, await req.db.storeSetting.upsert({ where: { storeId: req.params.storeId }, update: req.body, create: { storeId: req.params.storeId, ...req.body } }))));
  router.get('/:storeId/coupons', requireStorePermission('STORE_UPDATE'), asyncRoute(async (req, res) => success(res, await req.db.coupon.findMany({ where: { storeId: req.params.storeId }, orderBy: { createdAt: 'desc' } }))));
  router.post('/:storeId/coupons', requireStorePermission('STORE_UPDATE'), validate(z.object({ code: z.string().trim().min(2).max(40), percentOffBps: z.number().int().min(1).max(10000).optional(), fixedOffKobo: moneyString.optional(), minimumKobo: moneyString.default(0), maxUses: z.number().int().positive().optional(), startsAt: z.coerce.date().optional(), expiresAt: z.coerce.date().optional() }).refine((value) => Boolean(value.percentOffBps) !== Boolean(value.fixedOffKobo), 'Set exactly one discount type.')), asyncRoute(async (req, res) => created(res, await req.db.coupon.create({ data: { storeId: req.params.storeId, ...req.body, fixedOffKobo: req.body.fixedOffKobo === undefined ? null : BigInt(req.body.fixedOffKobo), minimumKobo: BigInt(req.body.minimumKobo) } }))));
  return router;
}
