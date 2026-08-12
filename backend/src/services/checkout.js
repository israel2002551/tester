import { env } from '../config/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { clampDiscount, percentage } from '../lib/money.js';

function available(inventory) {
  return (inventory?.onHand || 0) - (inventory?.reserved || 0);
}

export function priceCheckoutItems(cartItems, coupon, now = new Date()) {
  if (!cartItems.length) throw badRequest('EMPTY_CART', 'Add at least one available item before checkout.');
  let subtotalKobo = 0n;
  let shippingKobo = 0n;
  const items = cartItems.map(({ quantity, variant }) => {
    const product = variant.product;
    if (!variant.active || product.status !== 'ACTIVE' || product.deletedAt || product.store.status !== 'ACTIVE') {
      throw conflict('PRODUCT_UNAVAILABLE', `${product.name} is no longer available.`);
    }
    if (!variant.inventory || available(variant.inventory) < quantity) {
      throw conflict('INSUFFICIENT_STOCK', `${product.name} does not have enough available stock.`);
    }
    const lineSubtotal = variant.priceKobo * BigInt(quantity);
    const lineShipping = product.shippingFeeKobo * BigInt(quantity);
    subtotalKobo += lineSubtotal;
    shippingKobo += lineShipping;
    return {
      variantId: variant.id,
      storeId: product.storeId,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      unitPriceKobo: variant.priceKobo,
      shippingUnitKobo: product.shippingFeeKobo,
      quantity,
    };
  });

  let discountKobo = 0n;
  if (coupon) {
    if (!coupon.active || (coupon.startsAt && coupon.startsAt > now) || (coupon.expiresAt && coupon.expiresAt <= now) || (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)) {
      throw conflict('COUPON_UNAVAILABLE', 'That coupon is inactive, expired, or fully redeemed.');
    }
    const eligibleSubtotal = items.filter((item) => item.storeId === coupon.storeId)
      .reduce((sum, item) => sum + item.unitPriceKobo * BigInt(item.quantity), 0n);
    if (eligibleSubtotal < coupon.minimumKobo) throw conflict('COUPON_MINIMUM_NOT_MET', 'The eligible items do not meet this coupon minimum.');
    discountKobo = coupon.percentOffBps !== null
      ? percentage(eligibleSubtotal, coupon.percentOffBps)
      : (coupon.fixedOffKobo || 0n);
    discountKobo = clampDiscount(discountKobo, eligibleSubtotal);
  }
  const platformFeeKobo = 0n;
  return { items, subtotalKobo, shippingKobo, discountKobo, platformFeeKobo, totalKobo: subtotalKobo + shippingKobo + platformFeeKobo - discountKobo };
}

export async function createCheckoutQuote(db, userId, input) {
  const [address, cart] = await Promise.all([
    db.address.findFirst({ where: { id: input.addressId, userId } }),
    db.cart.findUnique({
      where: { userId },
      include: { items: { include: { variant: { include: { inventory: true, product: { include: { store: true } } } } } } },
    }),
  ]);
  if (!address) throw notFound('Delivery address');
  if (!cart?.items?.length) throw badRequest('EMPTY_CART', 'Your cart is empty.');
  let coupon = null;
  if (input.couponCode) {
    coupon = await db.coupon.findFirst({ where: { code: input.couponCode.trim(), active: true } });
    if (!coupon) throw notFound('Coupon');
  }
  const priced = priceCheckoutItems(cart.items, coupon);
  const expiresAt = new Date(Date.now() + env.CHECKOUT_QUOTE_TTL_MINUTES * 60_000);
  return db.$transaction(async (tx) => {
    await tx.checkoutQuote.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
    return tx.checkoutQuote.create({
      data: {
        userId, addressId: address.id, couponId: coupon?.id,
        currency: 'NGN', deliveryMethod: input.deliveryMethod,
        pricingVersion: `ng-v1-${env.PLATFORM_COMMISSION_BPS}`, expiresAt,
        subtotalKobo: priced.subtotalKobo, shippingKobo: priced.shippingKobo,
        discountKobo: priced.discountKobo, platformFeeKobo: priced.platformFeeKobo, totalKobo: priced.totalKobo,
        items: { create: priced.items },
      },
      include: { items: true, address: true },
    });
  });
}

export async function getCheckoutQuote(db, userId, id) {
  const quote = await db.checkoutQuote.findFirst({ where: { id, userId }, include: { items: true, address: true } });
  if (!quote) throw notFound('Checkout quote');
  if (quote.status === 'ACTIVE' && quote.expiresAt <= new Date()) {
    return db.checkoutQuote.update({ where: { id }, data: { status: 'EXPIRED' }, include: { items: true, address: true } });
  }
  return quote;
}
