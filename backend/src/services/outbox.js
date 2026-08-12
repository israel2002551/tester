import { deliverPush } from './notifications.js';
import { sendEmail } from './email.js';

const MAX_ATTEMPTS = 10;
const LEASE_MS = 5 * 60_000;

export function retryDelay(attempt) {
  return Math.min(6 * 60 * 60_000, 15_000 * (2 ** Math.max(0, attempt - 1)));
}

async function handleNotification(db, event) {
  const notification = await db.notification.findUnique({ where: { id: event.payload.notificationId }, include: { user: { include: { notificationPreference: true } } } });
  if (!notification) return { ignored: true };
  const result = {};
  if (notification.user.notificationPreference?.pushMessages !== false) result.push = await deliverPush(db, notification.id);
  if (notification.user.notificationPreference?.emailOrderUpdates !== false && notification.user.email) {
    result.email = await sendEmail({ to: notification.user.email, template: notification.type === 'ORDER_PAID' ? 'order_paid' : 'order_status', data: { orderNumber: notification.data?.orderNumber || '', status: notification.data?.status || notification.type }, idempotencyKey: `${event.id}:email` });
  }
  return result;
}

async function handleEvent(db, event) {
  const payload = event.payload || {};
  if (event.topic === 'notification.created') return handleNotification(db, event);
  if (event.topic === 'order.created' || event.topic === 'payment.verified' || event.topic === 'order.status_changed') {
    const order = await db.order.findUnique({ where: { id: payload.orderId }, include: { buyer: true } });
    if (!order) return { ignored: true };
    const template = event.topic === 'order.created' ? 'order_created' : event.topic === 'payment.verified' ? 'order_paid' : 'order_status';
    return sendEmail({ to: order.buyer.email, template, data: { orderNumber: order.orderNumber, status: payload.to }, idempotencyKey: `${event.id}:buyer` });
  }
  if (event.topic.startsWith('payout.')) {
    const payout = await db.payoutRequest.findUnique({ where: { id: payload.payoutId }, include: { account: { include: { store: { include: { owner: true } } } } } });
    if (!payout) return { ignored: true };
    return sendEmail({ to: payout.account.store.owner.email, template: event.topic === 'payout.requested' ? 'payout_requested' : 'payout_status', data: { amount: (payout.amountKobo / 100n).toString(), status: payload.to || payout.status }, idempotencyKey: `${event.id}:owner` });
  }
  if (event.topic === 'dispute.opened') {
    const dispute = await db.dispute.findUnique({ where: { id: payload.disputeId }, include: { order: { include: { buyer: true, storeOrders: { include: { store: { include: { owner: true } } } } } } } });
    if (!dispute) return { ignored: true };
    const recipients = [...new Set([dispute.order.buyer.email, ...dispute.order.storeOrders.map((item) => item.store.owner.email)].filter(Boolean))];
    return Promise.all(recipients.map((to, index) => sendEmail({ to, template: 'dispute_opened', data: { orderNumber: dispute.order.orderNumber }, idempotencyKey: `${event.id}:party:${index}` })));
  }
  if (event.topic === 'message.created') {
    const message = await db.message.findUnique({ where: { id: payload.messageId }, include: { sender: { include: { profile: true } }, conversation: { include: { members: { include: { user: true } } } } } });
    if (!message) return { ignored: true };
    const recipients = message.conversation.members.filter((member) => member.userId !== message.senderId && member.user.email);
    return Promise.all(recipients.map((member) => sendEmail({ to: member.user.email, template: 'message_received', data: { senderName: message.sender.profile?.displayName }, idempotencyKey: `${event.id}:member:${member.userId}` })));
  }
  if (event.topic === 'broadcast.send') {
    const delivery = await db.broadcastDelivery.findUnique({ where: { id: payload.deliveryId }, include: { campaign: true, user: true } });
    if (!delivery || delivery.channel !== 'EMAIL') return { ignored: true };
    const sent = await sendEmail({ to: delivery.user.email, template: 'broadcast', data: { subject: delivery.campaign.subject, content: delivery.campaign.content }, idempotencyKey: `${event.id}:broadcast` });
    await db.broadcastDelivery.update({ where: { id: delivery.id }, data: { status: sent.skipped ? 'SKIPPED' : 'SENT', providerId: sent.id, deliveredAt: sent.skipped ? null : new Date() } });
    return sent;
  }
  return { ignored: true, reason: 'unhandled_topic' };
}

export async function claimOutboxBatch(db, { limit = 25, now = new Date() } = {}) {
  const candidates = await db.outboxEvent.findMany({ where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS }, availableAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: limit });
  const claimed = [];
  for (const event of candidates) {
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const result = await db.outboxEvent.updateMany({ where: { id: event.id, processedAt: null, attempts: event.attempts, availableAt: event.availableAt }, data: { attempts: { increment: 1 }, availableAt: leaseUntil } });
    if (result.count === 1) claimed.push({ ...event, attempts: event.attempts + 1, availableAt: leaseUntil });
  }
  return claimed;
}

export async function processOutboxEvent(db, event) {
  try {
    const result = await handleEvent(db, event);
    await db.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });
    return { eventId: event.id, ok: true, result };
  } catch (error) {
    const exhausted = event.attempts >= MAX_ATTEMPTS;
    await db.outboxEvent.update({ where: { id: event.id }, data: { lastError: String(error.message).slice(0, 2000), availableAt: exhausted ? new Date('9999-12-31T00:00:00.000Z') : new Date(Date.now() + retryDelay(event.attempts)) } });
    return { eventId: event.id, ok: false, exhausted, error };
  }
}

export async function processOutboxBatch(db, options) {
  const events = await claimOutboxBatch(db, options);
  const results = [];
  for (const event of events) results.push(await processOutboxEvent(db, event));
  return results;
}
