import webpush from 'web-push';
import { env } from '../config/env.js';
import { outbox } from '../lib/records.js';

let configured = false;
function configure() {
  if (!configured && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return configured;
}

export async function createNotification(tx, userId, input) {
  const notification = await tx.notification.create({ data: { userId, type: input.type, title: input.title, body: input.body, data: input.data || {} } });
  await outbox(tx, 'notification.created', notification.id, { notificationId: notification.id, userId });
  return notification;
}

export async function deliverPush(db, notificationId) {
  if (!configure()) return { delivered: 0, skipped: true };
  const notification = await db.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return { delivered: 0 };
  const subscriptions = await db.pushSubscription.findMany({ where: { userId: notification.userId } });
  const payload = JSON.stringify({ title: notification.title, body: notification.body, data: notification.data });
  const results = await Promise.allSettled(subscriptions.map((subscription) => webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload)));
  const expired = subscriptions.filter((_subscription, index) => results[index].status === 'rejected' && [404, 410].includes(results[index].reason?.statusCode));
  if (expired.length) await db.pushSubscription.deleteMany({ where: { id: { in: expired.map((item) => item.id) } } });
  return { delivered: results.filter((result) => result.status === 'fulfilled').length, failed: results.filter((result) => result.status === 'rejected').length };
}
