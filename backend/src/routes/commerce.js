import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { asyncRoute, created, pageMeta, pagination, success } from '../lib/http.js';
import { cleanText, uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';
import { createCheckoutQuote, getCheckoutQuote } from '../services/checkout.js';
import { cancelOrder, createOrder } from '../services/orders.js';
import { initializePayment, processFlutterwaveWebhookEvent, receiveFlutterwaveWebhook, verifyPayment } from '../services/payments.js';

export function createCommerceRouter() {
  const router = Router();
  const webhook = asyncRoute(async (req, res) => {
    const accepted = await receiveFlutterwaveWebhook(req.db, req.rawBody, req.body, req.get('flutterwave-signature'));
    res.status(200).json({ received: true, duplicate: accepted.duplicate });
    if (!accepted.duplicate || ['RECEIVED', 'FAILED'].includes(accepted.event?.status)) {
      setImmediate(() => processFlutterwaveWebhookEvent(req.db, accepted.event.id).catch((error) => req.log?.error({ err: error, eventId: accepted.event.id }, 'webhook processing failed')));
    }
  });
  router.post('/webhooks/flutterwave', webhook);
  router.post('/payments/flutterwave/webhook', webhook);
  router.post('/checkout/quotes', ...requireAuth(), validate(z.object({ addressId: uuid, deliveryMethod: z.enum(['STANDARD', 'EXPRESS', 'PICKUP']).default('STANDARD'), couponCode: z.string().trim().min(1).max(40).optional() })), asyncRoute(async (req, res) => created(res, await createCheckoutQuote(req.db, req.user.id, req.body))));
  router.get('/checkout/quotes/:id', ...requireAuth(), asyncRoute(async (req, res) => success(res, await getCheckoutQuote(req.db, req.user.id, req.params.id))));
  router.post('/orders', ...requireAuth(), validate(z.object({ quoteId: uuid })), asyncRoute(async (req, res) => {
    const key = String(req.get('idempotency-key') || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header between 8 and 128 safe characters.');
    return created(res, await createOrder(req.db, req.user.id, req.body.quoteId, key));
  }));
  router.get('/orders', ...requireAuth(), asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const where = { buyerId: req.user.id };
    const [orders, total] = await Promise.all([
      req.db.order.findMany({ where, include: { storeOrders: { include: { store: { select: { id: true, name: true, slug: true } }, items: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.order.count({ where }),
    ]);
    return success(res, orders, pageMeta(page.page, page.limit, total));
  }));
  router.get('/orders/:id', ...requireAuth(), asyncRoute(async (req, res) => {
    const order = await req.db.order.findFirst({ where: { id: req.params.id, buyerId: req.user.id }, include: { storeOrders: { include: { store: true, items: true, delivery: true } }, payments: { select: { id: true, provider: true, amountKobo: true, currency: true, status: true, verifiedAt: true } }, events: { orderBy: { createdAt: 'asc' } } } });
    if (!order) throw notFound('Order');
    return success(res, order);
  }));
  router.post('/orders/:id/cancel', ...requireAuth(), validate(z.object({ reason: cleanText(500) })), asyncRoute(async (req, res) => success(res, await cancelOrder(req.db, req.user.id, req.params.id, req.body.reason))));
  router.post('/orders/:id/payments/flutterwave', ...requireAuth(), asyncRoute(async (req, res) => created(res, await initializePayment(req.db, req.user, req.params.id))));
  router.post('/payments/:id/verify', ...requireAuth(), validate(z.object({ transactionId: z.union([z.string().min(1).max(120), z.number().int().positive()]) })), asyncRoute(async (req, res) => success(res, await verifyPayment(req.db, req.user.id, req.params.id, String(req.body.transactionId)))));
  router.get('/payments/:id', ...requireAuth(), asyncRoute(async (req, res) => {
    const payment = await req.db.payment.findUnique({ where: { id: req.params.id }, include: { order: { select: { buyerId: true, orderNumber: true } } } });
    if (!payment) throw notFound('Payment');
    if (payment.order.buyerId !== req.user.id) throw forbidden();
    return success(res, { id: payment.id, orderId: payment.orderId, provider: payment.provider, amountKobo: payment.amountKobo, currency: payment.currency, status: payment.status, verifiedAt: payment.verifiedAt });
  }));
  return router;
}
