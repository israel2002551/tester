import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, forbidden, notFound, unavailable } from '../lib/errors.js';
import { reference } from '../lib/ids.js';
import { majorUnits } from '../lib/money.js';
import { outbox } from '../lib/records.js';
import { serializable } from '../lib/transactions.js';

const FLUTTERWAVE_API = 'https://api.flutterwave.com/v3';

function requireProviderConfig() {
  if (!env.FLUTTERWAVE_SECRET_KEY || !env.PAYMENT_REDIRECT_URL) throw unavailable('PAYMENTS_NOT_CONFIGURED', 'Online payment is temporarily unavailable.');
}

export function paymentRedirectUrl(paymentId, orderId, base = env.PAYMENT_REDIRECT_URL) {
  if (!base) throw unavailable('PAYMENTS_NOT_CONFIGURED', 'Online payment is temporarily unavailable.');
  const url = new URL(base);
  url.searchParams.set('payment', paymentId);
  url.searchParams.set('order', orderId);
  return url.toString();
}

async function flutterwave(path, options = {}) {
  requireProviderConfig();
  const response = await fetch(`${FLUTTERWAVE_API}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`, 'content-type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === 'error') {
    const error = unavailable('PAYMENT_PROVIDER_ERROR', 'The payment provider could not process this request.');
    error.providerStatus = response.status;
    throw error;
  }
  return payload;
}

function majorToKobo(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

export function verifyFlutterwaveSignature(rawBody, signature, secret = env.FLUTTERWAVE_WEBHOOK_HASH) {
  if (!secret || !signature || !rawBody) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const received = String(signature).trim();
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function validateVerifiedCharge(data, payment) {
  if (String(data?.status).toLowerCase() !== 'successful') throw conflict('PAYMENT_NOT_SUCCESSFUL', 'The payment has not completed successfully.');
  if (String(data.tx_ref) !== payment.internalReference) throw conflict('PAYMENT_REFERENCE_MISMATCH', 'The payment reference does not match this order.');
  if (String(data.currency).toUpperCase() !== payment.currency.toUpperCase()) throw conflict('PAYMENT_CURRENCY_MISMATCH', 'The payment currency does not match this order.');
  const receivedKobo = majorToKobo(data.amount);
  if (receivedKobo === null || receivedKobo < payment.amountKobo) throw conflict('PAYMENT_AMOUNT_MISMATCH', 'The amount received is less than the order total.');
  return { receivedKobo, providerTransactionId: String(data.id), providerReference: data.flw_ref ? String(data.flw_ref) : null };
}

export async function initializePayment(db, user, orderId) {
  requireProviderConfig();
  const order = await db.order.findFirst({ where: { id: orderId, buyerId: user.id }, include: { payments: true } });
  if (!order) throw notFound('Order');
  if (order.paymentStatus === 'PAID') throw conflict('ORDER_ALREADY_PAID', 'This order has already been paid.');
  if (!['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(order.status)) throw conflict('ORDER_NOT_PAYABLE', 'This order cannot accept a payment in its current state.');

  let payment = order.payments.find((item) => item.provider === 'FLUTTERWAVE' && item.status === 'PENDING');
  if (!payment) {
    payment = await db.payment.create({
      data: { orderId, provider: 'FLUTTERWAVE', internalReference: reference('PAY'), amountKobo: order.totalKobo, currency: order.currency },
    });
  }
  const existing = await db.paymentAttempt.findFirst({ where: { paymentId: payment.id, status: 'INITIALIZED' }, orderBy: { createdAt: 'desc' } });
  if (existing?.providerPayload?.checkoutUrl) return { payment, paymentId: payment.id, orderId: order.id, checkoutUrl: existing.providerPayload.checkoutUrl, reused: true };

  const attempt = await db.paymentAttempt.create({ data: { paymentId: payment.id, internalRef: reference('ATTEMPT') } });
  try {
    const payload = await flutterwave('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: payment.internalReference,
        amount: majorUnits(payment.amountKobo),
        currency: payment.currency,
        redirect_url: paymentRedirectUrl(payment.id, order.id),
        customer: { email: user.email || `buyer-${user.id}@users.invalid`, name: user.profile?.displayName || 'BUYSELL customer' },
        customizations: { title: 'BUYSELL order payment', description: `Payment for order ${order.orderNumber}` },
        meta: { order_id: order.id, payment_id: payment.id, attempt_id: attempt.id },
      }),
    });
    const checkoutUrl = payload?.data?.link;
    if (!checkoutUrl) throw unavailable('PAYMENT_PROVIDER_ERROR', 'The payment provider did not return a checkout link.');
    const writes = [
      db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'INITIALIZED', providerPayload: { checkoutUrl } } }),
      db.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PROCESSING' } }),
    ];
    if (order.status !== 'PAYMENT_PROCESSING') writes.push(db.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: 'PAYMENT_PROCESSING', actorId: user.id, note: 'Payment checkout initialized' } }));
    await db.$transaction(writes);
    return { payment, paymentId: payment.id, orderId: order.id, checkoutUrl, reused: false };
  } catch (error) {
    await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', failureReason: String(error.message).slice(0, 500) } }).catch(() => {});
    throw error;
  }
}

async function settleVerifiedPayment(db, paymentId, verified) {
  return serializable(db, async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { storeOrders: true, reservations: true } } },
    });
    if (!payment) throw notFound('Payment');
    if (payment.status === 'PAID') return payment;
    const verifiedTransactionOwner = await tx.payment.findFirst({ where: { providerTransactionId: verified.providerTransactionId, id: { not: payment.id } } });
    if (verifiedTransactionOwner) throw conflict('PAYMENT_TRANSACTION_REUSED', 'This provider transaction is already linked to another payment.');
    const otherPaid = await tx.payment.findFirst({ where: { orderId: payment.orderId, status: 'PAID', id: { not: payment.id } } });
    if (otherPaid) return otherPaid;

    for (const reservation of payment.order.reservations) {
      if (reservation.status !== 'RESERVED') {
        await outbox(tx, 'payment.inventory_exception', payment.orderId, { paymentId, reservationId: reservation.id, status: reservation.status });
        throw conflict('INVENTORY_RESERVATION_LOST', 'Payment was received but inventory requires manual reconciliation. Please contact support.');
      }
      const inventory = await tx.inventoryItem.findUnique({ where: { variantId: reservation.inventoryId } });
      if (!inventory || inventory.onHand < reservation.quantity || inventory.reserved < reservation.quantity) {
        await outbox(tx, 'payment.inventory_exception', payment.orderId, { paymentId, reservationId: reservation.id });
        throw conflict('INVENTORY_RECONCILIATION_REQUIRED', 'Payment was received but inventory requires manual reconciliation. Please contact support.');
      }
      await tx.inventoryItem.update({
        where: { variantId: reservation.inventoryId },
        data: { onHand: { decrement: reservation.quantity }, reserved: { decrement: reservation.quantity }, version: { increment: 1 } },
      });
      await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'COMMITTED' } });
      await tx.inventoryMovement.create({
        data: { inventoryId: reservation.inventoryId, type: 'SALE_COMMIT', onHandDelta: -reservation.quantity, reservedDelta: -reservation.quantity, referenceType: 'PAYMENT', referenceId: payment.id },
      });
    }

    for (const storeOrder of payment.order.storeOrders) {
      const account = await tx.ledgerAccount.upsert({ where: { storeId: storeOrder.storeId }, update: {}, create: { storeId: storeOrder.storeId, currency: payment.currency } });
      const gross = storeOrder.sellerNetKobo + storeOrder.commissionKobo;
      const ledgerEntries = [
        { accountId: account.id, storeOrderId: storeOrder.id, type: 'SALE_CREDIT', amountKobo: gross, idempotencyKey: `sale:${payment.id}:${storeOrder.id}`, description: `Sale proceeds for ${payment.order.orderNumber}` },
      ];
      if (storeOrder.commissionKobo > 0n) ledgerEntries.push({ accountId: account.id, storeOrderId: storeOrder.id, type: 'COMMISSION_DEBIT', amountKobo: -storeOrder.commissionKobo, idempotencyKey: `commission:${payment.id}:${storeOrder.id}`, description: `Platform commission for ${payment.order.orderNumber}` });
      await tx.ledgerEntry.createMany({
        data: ledgerEntries,
        skipDuplicates: true,
      });
    }
    const quote = await tx.checkoutQuote.findUnique({ where: { id: payment.order.quoteId }, include: { coupon: true } });
    if (quote?.coupon && quote.discountKobo > 0n) {
      const coupon = await tx.coupon.findUnique({ where: { id: quote.coupon.id } });
      if (!coupon?.active || (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)) {
        await outbox(tx, 'payment.coupon_exception', payment.orderId, { paymentId: payment.id, couponId: quote.coupon.id });
        throw conflict('COUPON_RECONCILIATION_REQUIRED', 'Payment was received but this coupon reached its redemption limit. Please contact support.');
      }
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      await tx.couponRedemption.create({ data: { couponId: coupon.id, userId: payment.order.buyerId, orderId: payment.orderId, discountKobo: quote.discountKobo } });
    }
    const now = new Date();
    const paid = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', verifiedAt: now, providerTransactionId: verified.providerTransactionId, providerReference: verified.providerReference },
    });
    await tx.paymentAttempt.updateMany({ where: { paymentId: payment.id, status: { in: ['CREATED', 'INITIALIZED'] } }, data: { status: 'VERIFIED' } });
    await tx.order.update({ where: { id: payment.orderId }, data: { status: 'PAID', paymentStatus: 'PAID', paidAt: now } });
    await tx.storeOrder.updateMany({ where: { orderId: payment.orderId }, data: { status: 'PAID' } });
    await tx.orderStatusEvent.create({ data: { orderId: payment.orderId, fromStatus: payment.order.status, toStatus: 'PAID', note: 'Payment verified by provider' } });
    await tx.notification.create({ data: { userId: payment.order.buyerId, type: 'ORDER_PAID', title: 'Payment confirmed', body: `Payment for ${payment.order.orderNumber} was confirmed.`, data: { orderId: payment.orderId } } });
    await outbox(tx, 'payment.verified', payment.orderId, { paymentId: payment.id, orderId: payment.orderId });
    return paid;
  });
}

export async function verifyPayment(db, userId, paymentId, transactionId, { allowAdmin = false } = {}) {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!payment) throw notFound('Payment');
  if (!allowAdmin && payment.order.buyerId !== userId) throw forbidden();
  if (payment.status === 'PAID') return payment;
  const response = await flutterwave(`/transactions/${encodeURIComponent(transactionId)}/verify`, { method: 'GET' });
  const verified = validateVerifiedCharge(response.data, payment);
  return settleVerifiedPayment(db, payment.id, verified);
}

export async function receiveFlutterwaveWebhook(db, rawBody, body, signature) {
  if (!verifyFlutterwaveSignature(rawBody, signature)) throw forbidden('The webhook signature is invalid.');
  const providerEventId = String(body.id || body.webhook_id || `${body.type || body.event}:${body.data?.id || createHash('sha256').update(rawBody).digest('hex')}`);
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  try {
    const event = await db.paymentWebhookEvent.create({
      data: { provider: 'FLUTTERWAVE', providerEventId, eventType: String(body.type || body.event || 'unknown'), payloadHash, payload: body },
    });
    return { event, duplicate: false };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return { event: await db.paymentWebhookEvent.findUnique({ where: { provider_providerEventId: { provider: 'FLUTTERWAVE', providerEventId } } }), duplicate: true };
  }
}

export async function processFlutterwaveWebhookEvent(db, eventId) {
  const event = await db.paymentWebhookEvent.findUnique({ where: { id: eventId } });
  if (!event || ['PROCESSED', 'IGNORED'].includes(event.status)) return event;
  try {
    const transactionId = event.payload?.data?.id;
    const txRef = event.payload?.data?.tx_ref || event.payload?.data?.txRef;
    if (!transactionId || !txRef) {
      return db.paymentWebhookEvent.update({ where: { id: event.id }, data: { status: 'IGNORED', processedAt: new Date(), failureReason: 'Event has no transaction identifier or reference.' } });
    }
    const payment = await db.payment.findUnique({ where: { internalReference: String(txRef) } });
    if (!payment) return db.paymentWebhookEvent.update({ where: { id: event.id }, data: { status: 'IGNORED', processedAt: new Date(), failureReason: 'Unknown payment reference.' } });
    const response = await flutterwave(`/transactions/${encodeURIComponent(transactionId)}/verify`, { method: 'GET' });
    const verified = validateVerifiedCharge(response.data, payment);
    await settleVerifiedPayment(db, payment.id, verified);
    return db.paymentWebhookEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), failureReason: null } });
  } catch (error) {
    await db.paymentWebhookEvent.update({ where: { id: event.id }, data: { status: 'FAILED', failureReason: String(error.message).slice(0, 500) } }).catch(() => {});
    throw error;
  }
}

export function recoverWebhooks(db, { limit = 20 } = {}) {
  return db.paymentWebhookEvent.findMany({ where: { status: { in: ['RECEIVED', 'FAILED'] } }, orderBy: { createdAt: 'asc' }, take: limit })
    .then((events) => Promise.allSettled(events.map((event) => processFlutterwaveWebhookEvent(db, event.id))));
}
