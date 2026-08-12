import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { reference } from '../lib/ids.js';
import { percentage } from '../lib/money.js';
import { outbox } from '../lib/records.js';
import { serializable } from '../lib/transactions.js';
import { assertTransition } from '../lib/transitions.js';

function addressSnapshot(address) {
  return {
    recipientName: address.recipientName, phone: address.phone, line1: address.line1, line2: address.line2,
    city: address.city, state: address.state, postalCode: address.postalCode, country: address.country,
  };
}

function groupQuoteItems(quote) {
  const groups = new Map();
  for (const item of quote.items) {
    const current = groups.get(item.storeId) || { storeId: item.storeId, items: [], subtotalKobo: 0n, shippingKobo: 0n };
    current.items.push(item);
    current.subtotalKobo += item.unitPriceKobo * BigInt(item.quantity);
    current.shippingKobo += item.shippingUnitKobo * BigInt(item.quantity);
    groups.set(item.storeId, current);
  }
  if (quote.coupon) {
    const eligible = groups.get(quote.coupon.storeId);
    if (eligible) eligible.discountKobo = quote.discountKobo;
  }
  return [...groups.values()];
}

export async function createOrder(db, userId, quoteId, idempotencyKey) {
  const prior = await db.order.findUnique({ where: { idempotencyKey }, include: { storeOrders: { include: { items: true } }, items: true } });
  if (prior) {
    if (prior.buyerId !== userId) throw forbidden();
    return prior;
  }
  return serializable(db, async (tx) => {
    const duplicate = await tx.order.findUnique({ where: { idempotencyKey }, include: { storeOrders: { include: { items: true } }, items: true } });
    if (duplicate) {
      if (duplicate.buyerId !== userId) throw forbidden();
      return duplicate;
    }
    const quote = await tx.checkoutQuote.findFirst({
      where: { id: quoteId, userId },
      include: {
        address: true, coupon: true,
        items: { include: { variant: { include: { inventory: true, product: { include: { store: true } } } } } },
      },
    });
    if (!quote) throw notFound('Checkout quote');
    if (quote.status !== 'ACTIVE') throw conflict('QUOTE_NOT_ACTIVE', 'This checkout quote has already been used or expired.');
    if (quote.expiresAt <= new Date()) {
      await tx.checkoutQuote.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } });
      throw conflict('QUOTE_EXPIRED', 'This checkout quote has expired. Refresh checkout totals and try again.');
    }
    const orderId = randomUUID();
    const groups = groupQuoteItems(quote);
    await tx.order.create({
      data: {
        id: orderId, orderNumber: reference('BS'), idempotencyKey, buyerId: userId, quoteId: quote.id,
        currency: quote.currency, subtotalKobo: quote.subtotalKobo, shippingKobo: quote.shippingKobo,
        discountKobo: quote.discountKobo, platformFeeKobo: quote.platformFeeKobo, totalKobo: quote.totalKobo,
        deliveryMethod: quote.deliveryMethod, addressSnapshot: addressSnapshot(quote.address),
      },
    });

    for (const group of groups) {
      const storeOrderId = randomUUID();
      const discountKobo = group.discountKobo || 0n;
      let commissionKobo = 0n;
      const preparedItems = group.items.map((item) => {
        const product = item.variant.product;
        if (!item.variant.active || product.status !== 'ACTIVE' || product.deletedAt || product.store.status !== 'ACTIVE') {
          throw conflict('PRODUCT_UNAVAILABLE', `${item.productName} is no longer available.`);
        }
        const lineSubtotal = item.unitPriceKobo * BigInt(item.quantity);
        const lineCommission = percentage(lineSubtotal, env.PLATFORM_COMMISSION_BPS);
        commissionKobo += lineCommission;
        return { item, product, lineSubtotal, lineCommission, id: randomUUID() };
      });
      const grossKobo = group.subtotalKobo + group.shippingKobo - discountKobo;
      await tx.storeOrder.create({
        data: {
          id: storeOrderId, orderId, storeId: group.storeId, subtotalKobo: group.subtotalKobo,
          shippingKobo: group.shippingKobo, discountKobo, platformFeeKobo: 0n,
          commissionKobo, sellerNetKobo: grossKobo - commissionKobo, totalKobo: grossKobo,
        },
      });
      for (const prepared of preparedItems) {
        const { item, product, lineSubtotal, lineCommission, id } = prepared;
        const inventory = item.variant.inventory;
        if (!inventory || inventory.onHand - inventory.reserved < item.quantity) {
          throw conflict('INSUFFICIENT_STOCK', `${item.productName} does not have enough available stock.`);
        }
        const changed = await tx.inventoryItem.updateMany({
          where: { variantId: item.variantId, version: inventory.version, onHand: { gte: inventory.reserved + item.quantity } },
          data: { reserved: { increment: item.quantity }, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw conflict('INVENTORY_CHANGED', 'Inventory changed while the order was placed. Refresh checkout and try again.');
        const discountShare = group.subtotalKobo === 0n ? 0n : (discountKobo * lineSubtotal) / group.subtotalKobo;
        const sellerAmountKobo = lineSubtotal + item.shippingUnitKobo * BigInt(item.quantity) - discountShare - lineCommission;
        await tx.orderItem.create({
          data: {
            id, orderId, storeOrderId, variantId: item.variantId, productId: product.id,
            productName: item.productName, variantName: item.variantName, sku: item.sku,
            unitPriceKobo: item.unitPriceKobo, shippingUnitKobo: item.shippingUnitKobo, quantity: item.quantity,
            totalKobo: lineSubtotal + item.shippingUnitKobo * BigInt(item.quantity) - discountShare,
            sellerAmountKobo, platformCommissionKobo: lineCommission,
          },
        });
        await tx.inventoryReservation.create({
          data: {
            inventoryId: item.variantId, orderId, orderItemId: id, quantity: item.quantity,
            expiresAt: new Date(Date.now() + env.INVENTORY_RESERVATION_MINUTES * 60_000),
          },
        });
        await tx.inventoryMovement.create({
          data: { inventoryId: item.variantId, type: 'RESERVE', reservedDelta: item.quantity, referenceType: 'ORDER', referenceId: orderId, actorId: userId },
        });
      }
    }
    await tx.checkoutQuote.update({ where: { id: quote.id }, data: { status: 'CONSUMED', consumedAt: new Date() } });
    await tx.orderStatusEvent.create({ data: { orderId, toStatus: 'PENDING_PAYMENT', actorId: userId, note: 'Order placed' } });
    await outbox(tx, 'order.created', orderId, { orderId, buyerId: userId });
    await tx.cartItem.deleteMany({ where: { cart: { userId }, variantId: { in: quote.items.map((item) => item.variantId) } } });
    return tx.order.findUnique({ where: { id: orderId }, include: { storeOrders: { include: { items: true, store: true } }, items: true, events: true } });
  });
}

export async function expireInventoryReservations(db, { limit = 100, now = new Date() } = {}) {
  const orders = await db.order.findMany({ where: { status: { in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'] }, reservations: { some: { status: 'RESERVED', expiresAt: { lte: now } } } }, select: { id: true }, take: limit });
  const results = [];
  for (const candidate of orders) {
    const result = await serializable(db, async (tx) => {
      const order = await tx.order.findUnique({ where: { id: candidate.id }, include: { reservations: true } });
      if (!order || !['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(order.status)) return { orderId: candidate.id, skipped: true };
      const expired = order.reservations.filter((reservation) => reservation.status === 'RESERVED' && reservation.expiresAt <= now);
      if (!expired.length) return { orderId: order.id, skipped: true };
      for (const reservation of expired) {
        const inventory = await tx.inventoryItem.findUnique({ where: { variantId: reservation.inventoryId } });
        if (inventory && inventory.reserved >= reservation.quantity) {
          await tx.inventoryItem.update({ where: { variantId: reservation.inventoryId }, data: { reserved: { decrement: reservation.quantity }, version: { increment: 1 } } });
          await tx.inventoryMovement.create({ data: { inventoryId: reservation.inventoryId, type: 'RELEASE', reservedDelta: -reservation.quantity, referenceType: 'ORDER_EXPIRY', referenceId: order.id } });
        }
        await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED' } });
      }
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: now } });
      await tx.storeOrder.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: 'CANCELLED', note: 'Inventory reservation expired before payment verification' } });
      await outbox(tx, 'order.reservation_expired', order.id, { orderId: order.id });
      return { orderId: order.id, released: expired.length };
    });
    results.push(result);
  }
  return results;
}

export async function transitionOrder(tx, order, toStatus, actorId, note) {
  assertTransition('order', order.status, toStatus);
  const now = new Date();
  const data = { status: toStatus };
  if (toStatus === 'CANCELLED') data.cancelledAt = now;
  if (toStatus === 'DELIVERED') data.deliveredAt = now;
  const updated = await tx.order.update({ where: { id: order.id }, data });
  await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus, actorId, note } });
  await outbox(tx, 'order.status_changed', order.id, { orderId: order.id, from: order.status, to: toStatus });
  return updated;
}

const FULFILMENT_STAGES = ['PAID', 'PROCESSING', 'READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export function aggregateStoreOrderStatus(statuses, currentParent) {
  if (!statuses.length) return currentParent;
  if (statuses.some((status) => status === 'DISPUTED')) return 'DISPUTED';
  if (statuses.every((status) => status === 'CANCELLED')) return 'CANCELLED';
  if (statuses.some((status) => ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(status))) return currentParent;
  const indices = statuses.map((status) => FULFILMENT_STAGES.indexOf(status));
  if (indices.some((index) => index < 0)) return currentParent;
  const aggregate = FULFILMENT_STAGES[Math.min(...indices)];
  return FULFILMENT_STAGES.indexOf(aggregate) > FULFILMENT_STAGES.indexOf(currentParent) ? aggregate : currentParent;
}

export async function advanceParentOrder(tx, order, storeStatuses, actorId, note) {
  const target = aggregateStoreOrderStatus(storeStatuses, order.status);
  if (target === order.status) return order;
  if (['DISPUTED', 'CANCELLED'].includes(target)) return transitionOrder(tx, order, target, actorId, note);
  let current = order;
  let index = FULFILMENT_STAGES.indexOf(current.status);
  const targetIndex = FULFILMENT_STAGES.indexOf(target);
  while (index >= 0 && index < targetIndex) {
    const next = FULFILMENT_STAGES[index + 1];
    current = await transitionOrder(tx, current, next, actorId, note);
    index += 1;
  }
  return current;
}

export async function cancelOrder(db, userId, orderId, note) {
  return serializable(db, async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, buyerId: userId }, include: { reservations: true } });
    if (!order) throw notFound('Order');
    if (!['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(order.status)) throw conflict('ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled directly.');
    for (const reservation of order.reservations.filter((item) => item.status === 'RESERVED')) {
      await tx.inventoryItem.update({ where: { variantId: reservation.inventoryId }, data: { reserved: { decrement: reservation.quantity }, version: { increment: 1 } } });
      await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'RELEASED' } });
      await tx.inventoryMovement.create({ data: { inventoryId: reservation.inventoryId, type: 'RELEASE', reservedDelta: -reservation.quantity, referenceType: 'ORDER', referenceId: order.id, actorId: userId } });
    }
    await tx.storeOrder.updateMany({ where: { orderId }, data: { status: 'CANCELLED' } });
    return transitionOrder(tx, order, 'CANCELLED', userId, note);
  });
}
