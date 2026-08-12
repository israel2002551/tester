import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { hasPlatformPermission, requirePlatformPermission } from '../auth/permissions.js';
import { conflict, notFound } from '../lib/errors.js';
import { asyncRoute, created, pageMeta, pagination, success } from '../lib/http.js';
import { audit } from '../lib/records.js';
import { assertTransition } from '../lib/transitions.js';
import { cleanText, moneyString, uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { decidePayout } from '../services/finance.js';
import { recoverWebhooks, verifyPayment } from '../services/payments.js';
import { createSourcingQuote, getInternalSourcing, listInternalSourcing, updateInternalSourcing, upsertProcurement } from '../services/sourcing.js';
import { safeSettingKeys, validateSafeSetting } from '../services/settings.js';

function listHandler(model, where = {}, include) {
  return asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const scoped = { ...where, ...(req.query.status ? { status: req.query.status } : {}) };
    const [rows, total] = await Promise.all([
      req.db[model].findMany({ where: scoped, ...(include ? { include } : {}), orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db[model].count({ where: scoped }),
    ]);
    return success(res, rows, pageMeta(page.page, page.limit, total));
  });
}

export function createAdminRouter() {
  const router = Router();
  router.use(...requireAuth());
  router.get('/dashboard', requirePlatformPermission('orders.read'), asyncRoute(async (req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [users, stores, orders, revenue, disputes, kyc, sourcing] = await Promise.all([
      req.db.user.count({ where: { createdAt: { gte: since } } }), req.db.store.count(), req.db.order.count({ where: { createdAt: { gte: since } } }),
      req.db.order.aggregate({ where: { paymentStatus: 'PAID', paidAt: { gte: since } }, _sum: { totalKobo: true }, _count: true }),
      req.db.dispute.count({ where: { status: { not: 'CLOSED' } } }), req.db.kycSubmission.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      req.db.sourcingRequest.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    ]);
    return success(res, { periodDays: 30, newUsers: users, stores, newOrders: orders, paidOrders: revenue._count, grossMerchandiseKobo: revenue._sum.totalKobo || 0n, openDisputes: disputes, pendingKyc: kyc, activeSourcing: sourcing });
  }));
  router.get('/users', requirePlatformPermission('users.read'), asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const where = { ...(req.query.status ? { status: req.query.status } : {}), ...(req.query.q ? { OR: [{ email: { contains: req.query.q, mode: 'insensitive' } }, { profile: { displayName: { contains: req.query.q, mode: 'insensitive' } } }] } : {}) };
    const [users, total] = await Promise.all([req.db.user.findMany({ where, include: { profile: true, platformRoles: true, storeMemberships: { include: { store: true } }, supplierProfile: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }), req.db.user.count({ where })]);
    return success(res, users, pageMeta(page.page, page.limit, total));
  }));
  router.get('/users/:id', requirePlatformPermission('users.read'), asyncRoute(async (req, res) => { const user = await req.db.user.findUnique({ where: { id: req.params.id }, include: { profile: true, platformRoles: true, storeMemberships: { include: { store: true, permissions: true } }, supplierProfile: true, orders: { orderBy: { createdAt: 'desc' }, take: 20 } } }); if (!user) throw notFound('User'); return success(res, user); }));
  router.get('/buyers', requirePlatformPermission('users.read'), listHandler('user', { orders: { some: {} } }, { profile: true, orders: { orderBy: { createdAt: 'desc' }, take: 5 }, _count: { select: { orders: true } } }));
  router.patch('/users/:id/status', requirePlatformPermission('users.manage'), validate(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: cleanText(500) })), asyncRoute(async (req, res) => {
    const current = await req.db.user.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound('User');
    if (current.id === req.user.id && req.body.status !== 'ACTIVE') throw conflict('SELF_LOCKOUT', 'You cannot deactivate your own account.');
    const updated = await req.db.$transaction(async (tx) => { const user = await tx.user.update({ where: { id: current.id }, data: { status: req.body.status } }); await audit(tx, req, { action: 'user.status_changed', targetType: 'User', targetId: user.id, before: { status: current.status }, after: { status: user.status, reason: req.body.reason } }); return user; });
    return success(res, updated);
  }));
  router.get('/stores', requirePlatformPermission('stores.read'), listHandler('store', {}, { owner: { include: { profile: true } }, _count: { select: { products: true, storeOrders: true } } }));
  router.get('/stores/:id', requirePlatformPermission('stores.read'), asyncRoute(async (req, res) => { const store = await req.db.store.findUnique({ where: { id: req.params.id }, include: { owner: { include: { profile: true } }, settings: true, memberships: { include: { user: { include: { profile: true } }, permissions: true } }, _count: { select: { products: true, storeOrders: true } } } }); if (!store) throw notFound('Store'); return success(res, store); }));
  router.get('/sellers', requirePlatformPermission('stores.read'), listHandler('store', {}, { owner: { include: { profile: true } }, memberships: { include: { user: { include: { profile: true } }, permissions: true } }, _count: { select: { products: true, storeOrders: true } } }));
  router.patch('/stores/:id/status', requirePlatformPermission('stores.manage'), validate(z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']), reason: cleanText(500) })), asyncRoute(async (req, res) => {
    const current = await req.db.store.findUnique({ where: { id: req.params.id } }); if (!current) throw notFound('Store');
    const updated = await req.db.$transaction(async (tx) => { const store = await tx.store.update({ where: { id: current.id }, data: { status: req.body.status } }); await audit(tx, req, { action: 'store.status_changed', targetType: 'Store', targetId: store.id, before: { status: current.status }, after: { status: store.status, reason: req.body.reason } }); return store; });
    return success(res, updated);
  }));
  router.get('/products', requirePlatformPermission('products.read'), listHandler('product', { deletedAt: null }, { store: true, variants: true, media: { include: { asset: true } } }));
  router.get('/products/:id', requirePlatformPermission('products.read'), asyncRoute(async (req, res) => { const product = await req.db.product.findUnique({ where: { id: req.params.id }, include: { store: true, variants: { include: { inventory: true } }, options: { include: { values: true } }, media: { include: { asset: true } }, reviews: true } }); if (!product) throw notFound('Product'); return success(res, product); }));
  router.get('/suppliers', requirePlatformPermission('stores.read'), listHandler('supplierProfile', {}, { user: { include: { profile: true } }, _count: { select: { products: true, connections: true, rfqQuotes: true } } }));
  router.get('/suppliers/:id', requirePlatformPermission('stores.read'), asyncRoute(async (req, res) => { const supplier = await req.db.supplierProfile.findUnique({ where: { id: req.params.id }, include: { user: { include: { profile: true } }, products: true, connections: { include: { store: true } }, rfqQuotes: { take: 50, orderBy: { createdAt: 'desc' } } } }); if (!supplier) throw notFound('Supplier'); return success(res, supplier); }));
  router.get('/categories', requirePlatformPermission('products.read'), asyncRoute(async (req, res) => success(res, await req.db.category.findMany({ include: { parent: true, _count: { select: { products: true, children: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }))));
  router.post('/categories', requirePlatformPermission('categories.manage'), validate(z.object({ name: cleanText(120), slug: z.string().trim().regex(/^[a-z0-9-]{2,80}$/), description: z.string().trim().max(1000).optional(), parentId: uuid.optional().nullable(), sortOrder: z.number().int().default(0), active: z.boolean().default(true) })), asyncRoute(async (req, res) => created(res, await req.db.category.create({ data: req.body }))));
  router.patch('/categories/:id', requirePlatformPermission('categories.manage'), validate(z.object({ name: cleanText(120).optional(), slug: z.string().trim().regex(/^[a-z0-9-]{2,80}$/).optional(), description: z.string().trim().max(1000).optional().nullable(), parentId: uuid.optional().nullable(), sortOrder: z.number().int().optional(), active: z.boolean().optional() })), asyncRoute(async (req, res) => {
    const category = await req.db.category.findUnique({ where: { id: req.params.id } }); if (!category) throw notFound('Category');
    if (req.body.parentId === category.id) throw conflict('CATEGORY_CYCLE', 'A category cannot be its own parent.');
    return success(res, await req.db.category.update({ where: { id: category.id }, data: req.body }));
  }));
  router.patch('/products/:id/moderation', requirePlatformPermission('products.moderate'), validate(z.object({ status: z.enum(['ACTIVE', 'REJECTED', 'PAUSED']), reason: cleanText(500) })), asyncRoute(async (req, res) => {
    const current = await req.db.product.findUnique({ where: { id: req.params.id } }); if (!current) throw notFound('Product');
    const updated = await req.db.$transaction(async (tx) => { const product = await tx.product.update({ where: { id: current.id }, data: { status: req.body.status, ...(req.body.status === 'ACTIVE' ? { publishedAt: current.publishedAt || new Date() } : {}) } }); await audit(tx, req, { action: 'product.moderated', targetType: 'Product', targetId: product.id, before: { status: current.status }, after: { status: product.status, reason: req.body.reason } }); return product; });
    return success(res, updated);
  }));
  router.get('/orders', requirePlatformPermission('orders.read'), listHandler('order', {}, { buyer: { include: { profile: true } }, storeOrders: { include: { store: true, items: true } }, payments: true }));
  router.get('/orders/:id', requirePlatformPermission('orders.read'), asyncRoute(async (req, res) => { const order = await req.db.order.findUnique({ where: { id: req.params.id }, include: { buyer: { include: { profile: true } }, storeOrders: { include: { store: true, items: true, delivery: true } }, payments: { include: { attempts: true } }, events: { orderBy: { createdAt: 'asc' } }, disputes: true } }); if (!order) throw notFound('Order'); return success(res, order); }));
  router.get('/payments', requirePlatformPermission('payments.read'), listHandler('payment', {}, { order: { select: { orderNumber: true, buyerId: true } }, attempts: true }));
  router.post('/payments/:id/verify', requirePlatformPermission('payments.read'), validate(z.object({ transactionId: z.union([z.string().min(1), z.number().int().positive()]) })), asyncRoute(async (req, res) => success(res, await verifyPayment(req.db, req.user.id, req.params.id, String(req.body.transactionId), { allowAdmin: true }))));
  router.post('/payments/webhooks/recover', requirePlatformPermission('payments.read'), asyncRoute(async (req, res) => success(res, await recoverWebhooks(req.db, { limit: 20 }))));
  router.get('/finance/ledger', requirePlatformPermission('finance.read'), asyncRoute(async (req, res) => { const page = pagination(req.query); const where = { ...(req.query.accountId ? { accountId: req.query.accountId } : {}) }; const [rows, total] = await Promise.all([req.db.ledgerEntry.findMany({ where, include: { account: { include: { store: true } }, storeOrder: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }), req.db.ledgerEntry.count({ where })]); return success(res, rows, pageMeta(page.page, page.limit, total)); }));
  router.get('/commissions', requirePlatformPermission('finance.read'), asyncRoute(async (req, res) => {
    const totals = await req.db.storeOrder.aggregate({ where: { status: { notIn: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'CANCELLED', 'REFUNDED'] } }, _sum: { commissionKobo: true, subtotalKobo: true }, _count: true });
    return success(res, { configuredBasisPoints: env.PLATFORM_COMMISSION_BPS, totalCommissionKobo: totals._sum.commissionKobo || 0n, eligibleSubtotalKobo: totals._sum.subtotalKobo || 0n, storeOrderCount: totals._count });
  }));
  router.get('/analytics', requirePlatformPermission('orders.read'), asyncRoute(async (req, res) => {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 86_400_000);
    if (Number.isNaN(since.valueOf())) throw conflict('INVALID_ANALYTICS_DATE', 'since must be a valid ISO date.');
    const [orders, payments, stores, users] = await Promise.all([
      req.db.order.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true, _sum: { totalKobo: true } }),
      req.db.payment.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true, _sum: { amountKobo: true } }),
      req.db.store.groupBy({ by: ['status'], _count: true }),
      req.db.user.groupBy({ by: ['status'], _count: true }),
    ]);
    return success(res, { since, orders, payments, stores, users });
  }));
  router.get('/payouts', requirePlatformPermission('payouts.manage'), listHandler('payoutRequest', {}, { account: { include: { store: true } }, destination: { select: { id: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true } }, transactions: true }));
  router.patch('/payout-destinations/:id/verification', requirePlatformPermission('payouts.manage'), validate(z.object({ verified: z.boolean(), providerReference: z.string().trim().min(1).max(200), reason: cleanText(500) })), asyncRoute(async (req, res) => {
    const current = await req.db.payoutDestination.findUnique({ where: { id: req.params.id }, select: { id: true, storeId: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true, active: true } });
    if (!current) throw notFound('Payout destination');
    const destination = await req.db.$transaction(async (tx) => {
      const updated = await tx.payoutDestination.update({ where: { id: current.id }, data: { verifiedAt: req.body.verified ? new Date() : null, active: req.body.verified } , select: { id: true, storeId: true, bankCode: true, accountName: true, fingerprint: true, verifiedAt: true, active: true } });
      await audit(tx, req, { action: req.body.verified ? 'payout_destination.verified' : 'payout_destination.rejected', targetType: 'PayoutDestination', targetId: current.id, before: { verifiedAt: current.verifiedAt, active: current.active }, after: { verifiedAt: updated.verifiedAt, active: updated.active, providerReference: req.body.providerReference, reason: req.body.reason } });
      return updated;
    });
    return success(res, destination);
  }));
  router.patch('/payouts/:id/status', requirePlatformPermission('payouts.manage'), validate(z.object({ status: z.enum(['UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED']), reason: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => success(res, await decidePayout(req.db, req.user.id, req.params.id, req.body.status, req.body.reason, { requestId: req.id, ipAddress: req.ip, userAgent: req.get('user-agent') }))));

  router.get('/kyc', requirePlatformPermission('kyc.read'), listHandler('kycSubmission', {}, { submittedBy: { include: { profile: true } }, documents: { select: { id: true, documentType: true, mediaAssetId: true } } }));
  router.get('/kyc/:id', requirePlatformPermission('kyc.read'), asyncRoute(async (req, res) => { const item = await req.db.kycSubmission.findUnique({ where: { id: req.params.id }, include: { submittedBy: { include: { profile: true } }, reviewedBy: { include: { profile: true } }, documents: { select: { id: true, documentType: true, mediaAssetId: true, createdAt: true } } } }); if (!item) throw notFound('Identity verification'); return success(res, item); }));
  router.patch('/kyc/:id', requirePlatformPermission('kyc.manage'), validate(z.object({ status: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED']), reason: z.string().trim().max(1000).optional() })), asyncRoute(async (req, res) => {
    const submission = await req.db.kycSubmission.findUnique({ where: { id: req.params.id } }); if (!submission) throw notFound('Identity verification'); assertTransition('kyc', submission.status, req.body.status);
    const updated = await req.db.$transaction(async (tx) => { const kyc = await tx.kycSubmission.update({ where: { id: submission.id }, data: { status: req.body.status, reviewedById: req.user.id, reviewedAt: new Date(), decisionReason: req.body.reason } }); await audit(tx, req, { action: 'kyc.reviewed', targetType: 'KycSubmission', targetId: kyc.id, before: { status: submission.status }, after: { status: kyc.status, reason: req.body.reason } }); return kyc; });
    return success(res, updated);
  }));
  router.get('/disputes', requirePlatformPermission('disputes.read'), listHandler('dispute', {}, { order: true, openedBy: { include: { profile: true } }, assignedAdmin: { include: { profile: true } }, messages: true, evidence: { select: { id: true, description: true, mediaAssetId: true } } }));
  router.get('/disputes/:id', requirePlatformPermission('disputes.read'), asyncRoute(async (req, res) => { const item = await req.db.dispute.findUnique({ where: { id: req.params.id }, include: { order: true, openedBy: { include: { profile: true } }, assignedAdmin: { include: { profile: true } }, messages: { include: { author: { include: { profile: true } } }, orderBy: { createdAt: 'asc' } }, evidence: { select: { id: true, description: true, mediaAssetId: true, createdAt: true } } } }); if (!item) throw notFound('Dispute'); return success(res, item); }));
  router.patch('/disputes/:id', requirePlatformPermission('disputes.manage'), validate(z.object({ status: z.enum(['UNDER_REVIEW', 'AWAITING_BUYER', 'AWAITING_SELLER', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED']), resolution: z.string().trim().max(5000).optional(), assignedAdminId: uuid.optional().nullable() })), asyncRoute(async (req, res) => {
    const dispute = await req.db.dispute.findUnique({ where: { id: req.params.id } }); if (!dispute) throw notFound('Dispute'); assertTransition('dispute', dispute.status, req.body.status);
    const updated = await req.db.$transaction(async (tx) => { const result = await tx.dispute.update({ where: { id: dispute.id }, data: { status: req.body.status, resolution: req.body.resolution, assignedAdminId: req.body.assignedAdminId ?? dispute.assignedAdminId } }); await audit(tx, req, { action: 'dispute.status_changed', targetType: 'Dispute', targetId: dispute.id, before: { status: dispute.status }, after: { status: result.status, resolution: req.body.resolution } }); return result; });
    return success(res, updated);
  }));

  router.get('/sourcing', requirePlatformPermission('sourcing.internal.read'), asyncRoute(async (req, res) => { const page = pagination(req.query); const result = await listInternalSourcing(req.db, { ...req.query, actorId: req.user.id, assignedToMe: req.query.assignedToMe === 'true' }, page); return success(res, result.requests, pageMeta(page.page, page.limit, result.total)); }));
  router.get('/sourcing/:id', requirePlatformPermission('sourcing.internal.read'), asyncRoute(async (req, res) => success(res, await getInternalSourcing(req.db, req.params.id))));
  router.patch('/sourcing/:id', requirePlatformPermission('sourcing.internal.write'), validate(z.object({ status: z.enum(['UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'QUOTE_READY', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'PROCUREMENT_IN_PROGRESS', 'PROCURED', 'INTERNATIONAL_TRANSIT', 'ARRIVED_IN_COUNTRY', 'LOCAL_FULFILMENT', 'COMPLETED', 'CANCELLED']).optional(), assignedAdminId: uuid.optional().nullable(), note: z.string().trim().max(2000).optional() })), asyncRoute(async (req, res) => success(res, await updateInternalSourcing(req.db, req.user.id, req.params.id, req.body))));
  router.put('/sourcing/:id/procurement', requirePlatformPermission('sourcing.procurement.manage'), validate(z.object({ sourcePlatform: z.enum(['INTERNAL_SUPPLIER', 'DIRECT_FACTORY', 'EXTERNAL_MARKETPLACE', 'OTHER']), providerCode: z.string().trim().max(120).optional(), sourceUrl: z.string().url().max(2048).optional(), supplierId: uuid.optional(), supplierReference: z.string().trim().max(200).optional(), supplierProductId: z.string().trim().max(200).optional(), supplierOrderId: z.string().trim().max(200).optional(), sourceCurrency: z.string().trim().length(3).optional(), sourceUnitCostMinor: moneyString.optional(), sourceShippingMinor: moneyString.optional(), exchangeRate: z.union([z.string().regex(/^\d+(\.\d{1,8})?$/), z.number().positive()]).optional(), internationalShippingKobo: moneyString.optional(), localDeliveryKobo: moneyString.optional(), internalStatus: z.string().trim().max(160).optional(), procurementNotes: z.string().trim().max(5000).optional() })), asyncRoute(async (req, res) => success(res, await upsertProcurement(req.db, req.params.id, req.body))));
  router.post('/sourcing/:id/quotes', requirePlatformPermission('sourcing.internal.write'), validate(z.object({ subtotalKobo: moneyString, serviceKobo: moneyString, shippingKobo: moneyString, expiresAt: z.coerce.date(), estimatedDeliveryAt: z.coerce.date().optional(), terms: z.string().trim().max(5000).optional() })), asyncRoute(async (req, res) => created(res, await createSourcingQuote(req.db, req.user.id, req.params.id, req.body))));

  router.get('/ads', requirePlatformPermission('advertising.manage'), listHandler('adCampaign', {}, { store: true, mediaAsset: true }));
  router.get('/ads/:id', requirePlatformPermission('advertising.manage'), asyncRoute(async (req, res) => { const ad = await req.db.adCampaign.findUnique({ where: { id: req.params.id }, include: { store: true, mediaAsset: true, events: { orderBy: { createdAt: 'desc' }, take: 100 } } }); if (!ad) throw notFound('Ad campaign'); return success(res, ad); }));
  router.patch('/ads/:id/status', requirePlatformPermission('advertising.manage'), validate(z.object({ status: z.enum(['PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'PAUSED', 'COMPLETED']), reason: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => { const ad = await req.db.adCampaign.findUnique({ where: { id: req.params.id } }); if (!ad) throw notFound('Ad campaign'); return success(res, await req.db.adCampaign.update({ where: { id: ad.id }, data: { status: req.body.status } })); }));
  router.get('/broadcasts', requirePlatformPermission('content.manage'), listHandler('broadcastCampaign', {}, { createdBy: { include: { profile: true } }, _count: { select: { deliveries: true } } }));
  router.get('/broadcasts/:id', requirePlatformPermission('content.manage'), asyncRoute(async (req, res) => { const campaign = await req.db.broadcastCampaign.findUnique({ where: { id: req.params.id }, include: { createdBy: { include: { profile: true } }, deliveries: { orderBy: { createdAt: 'desc' }, take: 100 } } }); if (!campaign) throw notFound('Broadcast'); return success(res, campaign); }));
  router.post('/broadcasts', requirePlatformPermission('content.manage'), validate(z.object({ subject: cleanText(180), previewText: z.string().trim().max(240).optional(), content: cleanText(50_000), channel: z.enum(['EMAIL', 'PUSH', 'IN_APP']), audience: z.record(z.string(), z.unknown()), scheduledAt: z.coerce.date().optional() })), asyncRoute(async (req, res) => {
    const campaign = await req.db.$transaction(async (tx) => { const createdCampaign = await tx.broadcastCampaign.create({ data: { createdById: req.user.id, ...req.body, status: req.body.scheduledAt ? 'SCHEDULED' : 'DRAFT' } }); await audit(tx, req, { action: 'broadcast.created', targetType: 'BroadcastCampaign', targetId: createdCampaign.id, before: null, after: { subject: createdCampaign.subject, channel: createdCampaign.channel, status: createdCampaign.status } }); return createdCampaign; });
    return created(res, campaign);
  }));
  router.patch('/broadcasts/:id', requirePlatformPermission('content.manage'), validate(z.object({ subject: cleanText(180).optional(), previewText: z.string().trim().max(240).optional().nullable(), content: cleanText(50_000).optional(), scheduledAt: z.coerce.date().optional().nullable(), status: z.enum(['DRAFT', 'SCHEDULED', 'CANCELLED']).optional() })), asyncRoute(async (req, res) => {
    const current = await req.db.broadcastCampaign.findUnique({ where: { id: req.params.id } }); if (!current) throw notFound('Broadcast'); if (!['DRAFT', 'SCHEDULED'].includes(current.status)) throw conflict('BROADCAST_IMMUTABLE', 'A processing or delivered broadcast cannot be edited.');
    const updated = await req.db.$transaction(async (tx) => { const campaign = await tx.broadcastCampaign.update({ where: { id: current.id }, data: req.body }); await audit(tx, req, { action: 'broadcast.updated', targetType: 'BroadcastCampaign', targetId: campaign.id, before: { subject: current.subject, status: current.status, scheduledAt: current.scheduledAt }, after: { subject: campaign.subject, status: campaign.status, scheduledAt: campaign.scheduledAt } }); return campaign; });
    return success(res, updated);
  }));
  router.post('/broadcasts/:id/send', requirePlatformPermission('content.manage'), asyncRoute(async (req, res) => {
    const campaign = await req.db.broadcastCampaign.findUnique({ where: { id: req.params.id } }); if (!campaign) throw notFound('Broadcast'); if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) throw conflict('BROADCAST_NOT_SENDABLE', 'This broadcast cannot be queued in its current state.');
    const result = await req.db.$transaction(async (tx) => {
      const users = await tx.user.findMany({ where: { status: 'ACTIVE', email: { not: null } }, select: { id: true } });
      await tx.broadcastDelivery.createMany({ data: users.map((user) => ({ campaignId: campaign.id, userId: user.id, channel: campaign.channel })), skipDuplicates: true });
      const deliveries = await tx.broadcastDelivery.findMany({ where: { campaignId: campaign.id, status: 'PENDING' }, select: { id: true } });
      await tx.outboxEvent.createMany({ data: deliveries.map((delivery) => ({ topic: 'broadcast.send', aggregateId: campaign.id, payload: { deliveryId: delivery.id } })) });
      const updated = await tx.broadcastCampaign.update({ where: { id: campaign.id }, data: { status: 'PROCESSING' } });
      await audit(tx, req, { action: 'broadcast.queued', targetType: 'BroadcastCampaign', targetId: campaign.id, before: { status: campaign.status }, after: { status: updated.status, recipientCount: deliveries.length } });
      return { campaign: updated, recipientCount: deliveries.length };
    });
    return success(res, result);
  }));
  router.get('/audit', requirePlatformPermission('users.read'), asyncRoute(async (req, res) => { const page = pagination(req.query, { defaultLimit: 50 }); const where = { ...(req.query.targetType ? { targetType: req.query.targetType } : {}), ...(req.query.actorId ? { actorId: req.query.actorId } : {}) }; const [logs, total] = await Promise.all([req.db.auditLog.findMany({ where, include: { actor: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }), req.db.auditLog.count({ where })]); return success(res, logs, pageMeta(page.page, page.limit, total)); }));
  router.get('/settings', requirePlatformPermission('settings.finance'), asyncRoute(async (req, res) => success(res, await req.db.siteSetting.findMany({ where: { key: { in: safeSettingKeys } }, select: { key: true, value: true, description: true, updatedAt: true, updatedById: true }, orderBy: { key: 'asc' } }))));
  router.put('/settings/:key', requirePlatformPermission('settings.finance'), validate(z.object({ value: z.unknown(), description: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => {
    const value = validateSafeSetting(req.params.key, req.body.value);
    const current = await req.db.siteSetting.findUnique({ where: { key: req.params.key } });
    const updated = await req.db.$transaction(async (tx) => {
      const setting = await tx.siteSetting.upsert({ where: { key: req.params.key }, update: { value, description: req.body.description, updatedById: req.user.id }, create: { key: req.params.key, value, description: req.body.description, updatedById: req.user.id } });
      await audit(tx, req, { action: 'setting.updated', targetType: 'SiteSetting', targetId: setting.key, before: current ? { value: current.value, description: current.description } : null, after: { value: setting.value, description: setting.description } });
      return setting;
    });
    return success(res, updated);
  }));
  router.get('/export/:resource', requirePlatformPermission('users.read'), asyncRoute(async (req, res) => {
    const allowed = { users: 'user', stores: 'store', orders: 'order', products: 'product', payouts: 'payoutRequest' };
    const model = allowed[req.params.resource]; if (!model) throw notFound('Export resource');
    const rows = await req.db[model].findMany({ orderBy: { createdAt: 'desc' }, take: 10_000 });
    await req.db.auditLog.create({ data: { actorId: req.user.id, action: 'admin.exported', targetType: 'Export', targetId: req.params.resource, after: { rowCount: rows.length, truncated: rows.length === 10_000 }, requestId: req.id, ipAddress: req.ip, userAgent: req.get('user-agent') } });
    return success(res, { resource: req.params.resource, generatedAt: new Date(), truncated: rows.length === 10_000, rows });
  }));
  router.get('/permissions', (_req, res) => success(res, { sourcingInternal: hasPlatformPermission(_req.user, 'sourcing.internal.read') }));
  return router;
}
