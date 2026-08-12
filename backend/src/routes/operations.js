import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { asyncRoute, created, success } from '../lib/http.js';
import { reference } from '../lib/ids.js';
import { assertTransition } from '../lib/transitions.js';
import { cleanText, moneyString, uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';

async function requireKycOwner(db, id, userId) {
  const submission = await db.kycSubmission.findFirst({ where: { id, submittedById: userId }, include: { documents: { include: { mediaAsset: true } } } });
  if (!submission) throw notFound('Identity verification');
  return submission;
}

export function createOperationsRouter() {
  const router = Router();
  router.get('/kyc', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.kycSubmission.findMany({ where: { submittedById: req.user.id }, include: { documents: { select: { id: true, documentType: true, mediaAssetId: true, createdAt: true } } }, orderBy: { createdAt: 'desc' } }))));
  router.post('/kyc', ...requireAuth(), validate(z.object({ subjectType: z.enum(['USER', 'STORE', 'SUPPLIER']), subjectId: cleanText(120), documents: z.array(z.object({ documentType: cleanText(80), mediaAssetId: uuid })).min(1).max(12) })), asyncRoute(async (req, res) => {
    if (req.body.subjectType === 'USER' && req.body.subjectId !== req.user.id) throw forbidden();
    if (req.body.subjectType === 'STORE' && !req.user.storeMemberships.some((item) => item.storeId === req.body.subjectId && item.role === 'OWNER')) throw forbidden();
    if (req.body.subjectType === 'SUPPLIER' && req.user.supplierProfile?.id !== req.body.subjectId) throw forbidden();
    const media = await req.db.mediaAsset.findMany({ where: { id: { in: req.body.documents.map((item) => item.mediaAssetId) }, ownerId: req.user.id, access: 'PRIVATE', kind: { in: ['IMAGE', 'DOCUMENT'] } } });
    if (media.length !== req.body.documents.length) throw badRequest('INVALID_KYC_DOCUMENT', 'Every verification document must be a private asset you uploaded.');
    const submission = await req.db.kycSubmission.create({ data: { subjectType: req.body.subjectType, subjectId: req.body.subjectId, submittedById: req.user.id, status: 'SUBMITTED', submittedAt: new Date(), documents: { create: req.body.documents } }, include: { documents: { select: { id: true, documentType: true, mediaAssetId: true } } } });
    return created(res, submission);
  }));
  router.get('/kyc/:id', ...requireAuth(), asyncRoute(async (req, res) => success(res, await requireKycOwner(req.db, req.params.id, req.user.id))));

  router.get('/disputes', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.dispute.findMany({ where: { OR: [{ openedById: req.user.id }, { order: { buyerId: req.user.id } }, { order: { storeOrders: { some: { store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE' } } } } } } }] }, include: { order: { select: { orderNumber: true, buyerId: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' } }))));
  router.post('/orders/:orderId/disputes', ...requireAuth(), validate(z.object({ reason: cleanText(160), description: cleanText(5000), evidenceAssetIds: z.array(uuid).max(10).default([]) })), asyncRoute(async (req, res) => {
    const order = await req.db.order.findFirst({ where: { id: req.params.orderId, OR: [{ buyerId: req.user.id }, { storeOrders: { some: { store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE' } } } } } }] } });
    if (!order) throw notFound('Order');
    if (['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'].includes(order.status)) throw conflict('ORDER_NOT_DISPUTABLE', 'This order cannot be disputed in its current state.');
    if (req.body.evidenceAssetIds.length) {
      const count = await req.db.mediaAsset.count({ where: { id: { in: req.body.evidenceAssetIds }, ownerId: req.user.id, access: 'PRIVATE' } });
      if (count !== req.body.evidenceAssetIds.length) throw badRequest('INVALID_EVIDENCE', 'Every evidence file must be a private asset you uploaded.');
    }
    const dispute = await req.db.$transaction(async (tx) => {
      const createdDispute = await tx.dispute.create({ data: { orderId: order.id, openedById: req.user.id, reason: req.body.reason, description: req.body.description, evidence: { create: req.body.evidenceAssetIds.map((mediaAssetId) => ({ mediaAssetId })) } } });
      if (!['DISPUTED', 'REFUND_PENDING'].includes(order.status)) {
        assertTransition('order', order.status, 'DISPUTED');
        await tx.order.update({ where: { id: order.id }, data: { status: 'DISPUTED' } });
        await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: 'DISPUTED', actorId: req.user.id, note: req.body.reason } });
      }
      await tx.outboxEvent.create({ data: { topic: 'dispute.opened', aggregateId: createdDispute.id, payload: { disputeId: createdDispute.id, orderId: order.id } } });
      return createdDispute;
    });
    return created(res, dispute);
  }));
  router.post('/disputes/:id/messages', ...requireAuth(), validate(z.object({ body: cleanText(5000) })), asyncRoute(async (req, res) => {
    const dispute = await req.db.dispute.findFirst({ where: { id: req.params.id, OR: [{ openedById: req.user.id }, { order: { buyerId: req.user.id } }, { order: { storeOrders: { some: { store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE' } } } } } } }] } });
    if (!dispute) throw notFound('Dispute');
    return created(res, await req.db.disputeMessage.create({ data: { disputeId: dispute.id, authorId: req.user.id, body: req.body.body } }));
  }));

  router.get('/services', asyncRoute(async (req, res) => success(res, await req.db.serviceListing.findMany({ where: { active: true, ...(req.query.category ? { category: req.query.category } : {}) }, include: { coverAsset: { select: { publicUrl: true } }, provider: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }))));
  router.get('/services/:id', asyncRoute(async (req, res) => {
    const service = await req.db.serviceListing.findFirst({ where: { OR: [{ id: req.params.id }, { slug: req.params.id }], active: true }, include: { coverAsset: { select: { publicUrl: true } }, provider: { include: { profile: true } }, _count: { select: { bookings: true } } } });
    if (!service) throw notFound('Service');
    return success(res, service);
  }));
  router.post('/services', ...requireAuth(), validate(z.object({ title: cleanText(180), slug: z.string().trim().regex(/^[a-z0-9-]{3,80}$/).optional(), description: cleanText(10_000), category: cleanText(100), location: z.string().trim().max(160).optional(), startingKobo: moneyString.optional(), coverAssetId: uuid.optional(), metadata: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (req, res) => created(res, await req.db.serviceListing.create({ data: { providerId: req.user.id, ...req.body, slug: req.body.slug || `${reference('service').toLowerCase()}-${req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, startingKobo: req.body.startingKobo === undefined ? null : BigInt(req.body.startingKobo) } }))));
  router.post('/services/:id/bookings', ...requireAuth(), validate(z.object({ agreedKobo: moneyString.optional(), scheduledFor: z.coerce.date().optional(), notes: z.string().trim().max(5000).optional() })), asyncRoute(async (req, res) => {
    const listing = await req.db.serviceListing.findFirst({ where: { id: req.params.id, active: true } });
    if (!listing) throw notFound('Service');
    if (listing.providerId === req.user.id) throw conflict('SELF_BOOKING', 'You cannot book your own service.');
    return created(res, await req.db.serviceBooking.create({ data: { listingId: listing.id, customerId: req.user.id, ...req.body, agreedKobo: req.body.agreedKobo === undefined ? null : BigInt(req.body.agreedKobo) } }));
  }));
  router.get('/service-bookings', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.serviceBooking.findMany({ where: { OR: [{ customerId: req.user.id }, { listing: { providerId: req.user.id } }] }, include: { listing: true, customer: { include: { profile: true } } }, orderBy: { createdAt: 'desc' } }))));
  router.patch('/service-bookings/:id/status', ...requireAuth(), validate(z.object({ status: z.enum(['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED']) })), asyncRoute(async (req, res) => {
    const booking = await req.db.serviceBooking.findFirst({ where: { id: req.params.id, OR: [{ customerId: req.user.id }, { listing: { providerId: req.user.id } }] }, include: { listing: true } });
    if (!booking) throw notFound('Service booking');
    if (['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(req.body.status) && booking.listing.providerId !== req.user.id) throw forbidden();
    assertTransition('booking', booking.status, req.body.status);
    return success(res, await req.db.serviceBooking.update({ where: { id: booking.id }, data: { status: req.body.status } }));
  }));

  router.get('/delivery/hubs', asyncRoute(async (req, res) => success(res, await req.db.fulfilmentHub.findMany({ where: { active: true }, orderBy: { name: 'asc' } }))));
  router.get('/delivery/assignments', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.deliveryAssignment.findMany({ where: { OR: [{ riderId: req.user.id }, { storeOrder: { store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE' } } } } }] }, include: { hub: true, storeOrder: { include: { store: { select: { id: true, name: true } }, order: { select: { orderNumber: true, addressSnapshot: true } } } } }, orderBy: { createdAt: 'desc' } }))));
  router.post('/delivery/assignments', ...requireAuth(), validate(z.object({ storeOrderId: uuid, riderId: uuid.optional(), hubId: uuid.optional() })), asyncRoute(async (req, res) => {
    const storeOrder = await req.db.storeOrder.findFirst({ where: { id: req.body.storeOrderId, store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'ORDER_MANAGER'] } } } } } });
    if (!storeOrder) throw forbidden();
    return created(res, await req.db.deliveryAssignment.create({ data: { ...req.body, trackingCode: reference('DLV') } }));
  }));
  router.patch('/delivery/assignments/:id/status', ...requireAuth(), validate(z.object({ status: z.enum(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED']), proofMetadata: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (req, res) => {
    const assignment = await req.db.deliveryAssignment.findFirst({ where: { id: req.params.id, OR: [{ riderId: req.user.id }, { storeOrder: { store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'ORDER_MANAGER'] } } } } } }] } });
    if (!assignment) throw notFound('Delivery assignment');
    assertTransition('delivery', assignment.status, req.body.status);
    return success(res, await req.db.deliveryAssignment.update({ where: { id: assignment.id }, data: { status: req.body.status, proofMetadata: req.body.proofMetadata, ...(req.body.status === 'PICKED_UP' ? { pickupAt: new Date() } : {}), ...(req.body.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}) } }));
  }));

  router.get('/rfqs', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.rfqRequest.findMany({ where: { requesterId: req.user.id }, include: { quotes: { include: { supplier: { select: { id: true, displayName: true, status: true } } } } }, orderBy: { createdAt: 'desc' } }))));
  router.post('/rfqs', ...requireAuth(), validate(z.object({ title: cleanText(180), description: cleanText(10_000), specifications: z.record(z.string(), z.unknown()).optional(), quantity: z.number().int().positive(), targetBudgetKobo: moneyString.optional(), deliveryLocation: z.string().trim().max(300).optional(), responseDeadline: z.coerce.date().optional(), publish: z.boolean().default(true) })), asyncRoute(async (req, res) => created(res, await req.db.rfqRequest.create({ data: { requestNumber: reference('RFQ'), requesterId: req.user.id, title: req.body.title, description: req.body.description, specifications: req.body.specifications || {}, quantity: req.body.quantity, targetBudgetKobo: req.body.targetBudgetKobo === undefined ? null : BigInt(req.body.targetBudgetKobo), deliveryLocation: req.body.deliveryLocation, responseDeadline: req.body.responseDeadline, status: req.body.publish ? 'OPEN' : 'DRAFT' } }))));
  router.post('/rfqs/:id/quotes/:quoteId/award', ...requireAuth(), asyncRoute(async (req, res) => {
    const rfq = await req.db.rfqRequest.findFirst({ where: { id: req.params.id, requesterId: req.user.id }, include: { quotes: true } });
    if (!rfq) throw notFound('Request for quote');
    const quote = rfq.quotes.find((item) => item.id === req.params.quoteId);
    if (!quote || quote.expiresAt <= new Date()) throw conflict('QUOTE_UNAVAILABLE', 'This supplier quote is unavailable or expired.');
    return success(res, await req.db.rfqRequest.update({ where: { id: rfq.id }, data: { status: 'AWARDED', awardedQuoteId: quote.id } }));
  }));
  return router;
}
