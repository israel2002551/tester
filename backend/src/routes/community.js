import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { forbidden, notFound } from '../lib/errors.js';
import { asyncRoute, created, pageMeta, pagination, success } from '../lib/http.js';
import { uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';

async function requireConversationMember(db, conversationId, userId) {
  const membership = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { conversation: true } });
  if (!membership) throw notFound('Conversation');
  return membership;
}

export function createCommunityRouter() {
  const router = Router();
  router.get('/conversations', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.conversationMember.findMany({ where: { userId: req.user.id }, include: { conversation: { include: { members: { include: { user: { include: { profile: true } } } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } } }, orderBy: { conversation: { updatedAt: 'desc' } } }))));
  router.post('/conversations', ...requireAuth(), validate(z.object({ type: z.enum(['DIRECT', 'ORDER', 'SOURCING', 'SUPPORT']), memberIds: z.array(uuid).min(1).max(20), orderId: uuid.optional(), sourcingRequestId: uuid.optional() })), asyncRoute(async (req, res) => {
    if (req.body.orderId) {
      const order = await req.db.order.findUnique({ where: { id: req.body.orderId }, include: { storeOrders: { include: { store: true } } } });
      const allowed = order && (order.buyerId === req.user.id || order.storeOrders.some((item) => item.store.ownerId === req.user.id));
      if (!allowed) throw forbidden();
    }
    if (req.body.sourcingRequestId) {
      const request = await req.db.sourcingRequest.findFirst({ where: { id: req.body.sourcingRequestId, requesterId: req.user.id } });
      if (!request) throw forbidden();
    }
    const members = [...new Set([req.user.id, ...req.body.memberIds])];
    const count = await req.db.user.count({ where: { id: { in: members }, status: 'ACTIVE' } });
    if (count !== members.length) throw notFound('Conversation member');
    const conversation = await req.db.conversation.create({ data: { type: req.body.type, orderId: req.body.orderId, sourcingRequestId: req.body.sourcingRequestId, members: { create: members.map((userId) => ({ userId })) } }, include: { members: true } });
    return created(res, conversation);
  }));
  router.get('/conversations/:id/messages', ...requireAuth(), asyncRoute(async (req, res) => {
    await requireConversationMember(req.db, req.params.id, req.user.id);
    const page = pagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const where = { conversationId: req.params.id, deletedAt: null };
    const [messages, total] = await Promise.all([
      req.db.message.findMany({ where, include: { sender: { include: { profile: true } }, mediaAsset: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.message.count({ where }),
    ]);
    await req.db.conversationMember.update({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } }, data: { lastReadAt: new Date() } });
    return success(res, messages.reverse(), pageMeta(page.page, page.limit, total));
  }));
  router.post('/conversations/:id/messages', ...requireAuth(), validate(z.object({ body: z.string().trim().max(10_000).default(''), type: z.enum(['TEXT', 'IMAGE']).default('TEXT'), mediaAssetId: uuid.optional() }).refine((value) => value.body.length > 0 || value.mediaAssetId, 'A message needs text or media.')), asyncRoute(async (req, res) => {
    await requireConversationMember(req.db, req.params.id, req.user.id);
    if (req.body.mediaAssetId) {
      const asset = await req.db.mediaAsset.findFirst({ where: { id: req.body.mediaAssetId, ownerId: req.user.id, kind: 'IMAGE' } });
      if (!asset) throw notFound('Message image');
    }
    const message = await req.db.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({ data: { conversationId: req.params.id, senderId: req.user.id, body: req.body.body, type: req.body.type, mediaAssetId: req.body.mediaAssetId } });
      await tx.conversation.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
      await tx.outboxEvent.create({ data: { topic: 'message.created', aggregateId: createdMessage.id, payload: { messageId: createdMessage.id, conversationId: req.params.id } } });
      return createdMessage;
    });
    return created(res, message);
  }));

  router.post('/orders/:orderId/items/:itemId/reviews', ...requireAuth(), validate(z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(5000).optional() })), asyncRoute(async (req, res) => {
    const item = await req.db.orderItem.findFirst({ where: { id: req.params.itemId, orderId: req.params.orderId, order: { buyerId: req.user.id, status: 'DELIVERED' } } });
    if (!item) throw notFound('Delivered order item');
    return created(res, await req.db.review.create({ data: { orderItemId: item.id, productId: item.productId, buyerId: req.user.id, rating: req.body.rating, body: req.body.body } }));
  }));
  router.patch('/reviews/:id', ...requireAuth(), validate(z.object({ rating: z.number().int().min(1).max(5).optional(), body: z.string().trim().max(5000).optional().nullable() })), asyncRoute(async (req, res) => {
    const review = await req.db.review.findFirst({ where: { id: req.params.id, buyerId: req.user.id } });
    if (!review) throw notFound('Review');
    return success(res, await req.db.review.update({ where: { id: review.id }, data: req.body }));
  }));

  router.get('/referrals', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.referralCode.findMany({ where: { ownerId: req.user.id }, include: { _count: { select: { visits: true, conversions: true } } } }))));
  router.post('/referrals', ...requireAuth(), validate(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{4,30}$/) })), asyncRoute(async (req, res) => created(res, await req.db.referralCode.create({ data: { ownerId: req.user.id, code: req.body.code } }))));
  router.post('/referrals/:code/visit', validate(z.object({ visitorId: uuid.optional(), anonymousId: z.string().trim().max(120).optional(), landingPath: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => {
    const code = await req.db.referralCode.findFirst({ where: { code: req.params.code, active: true } });
    if (!code) throw notFound('Referral code');
    return created(res, await req.db.referralVisit.create({ data: { codeId: code.id, ...req.body } }));
  }));
  return router;
}
