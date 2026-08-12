import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, userSummary } from '../auth/middleware.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asyncRoute, created, success } from '../lib/http.js';
import { cleanText, uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';

const addressSchema = z.object({ recipientName: cleanText(120), phone: cleanText(30), line1: cleanText(200), line2: z.string().trim().max(200).optional().nullable(), city: cleanText(100), state: cleanText(100), postalCode: z.string().trim().max(24).optional().nullable(), country: z.string().trim().min(2).max(80).default('Nigeria'), isDefault: z.boolean().default(false) });
const cartInclude = { items: { include: { variant: { include: { inventory: true, product: { include: { media: { include: { asset: true }, orderBy: { sortOrder: 'asc' }, take: 1 }, store: { select: { id: true, name: true, slug: true } } } } } } }, orderBy: { createdAt: 'asc' } } };

function cartDto(cart) {
  if (!cart) return { id: null, items: [], itemCount: 0, subtotalKobo: 0n };
  const items = cart.items.map((item) => ({
    id: item.id, quantity: item.quantity,
    variant: { id: item.variant.id, sku: item.variant.sku, name: item.variant.name, priceKobo: item.variant.priceKobo, available: Math.max(0, (item.variant.inventory?.onHand || 0) - (item.variant.inventory?.reserved || 0)) },
    product: { id: item.variant.product.id, slug: item.variant.product.slug, name: item.variant.product.name, shippingFeeKobo: item.variant.product.shippingFeeKobo, store: item.variant.product.store, imageUrl: item.variant.product.media[0]?.asset?.access === 'PUBLIC' ? item.variant.product.media[0].asset.publicUrl : null },
    lineSubtotalKobo: item.variant.priceKobo * BigInt(item.quantity),
  }));
  return { id: cart.id, items, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), subtotalKobo: items.reduce((sum, item) => sum + item.lineSubtotalKobo, 0n), updatedAt: cart.updatedAt };
}

async function getCart(db, userId) {
  return cartDto(await db.cart.findUnique({ where: { userId }, include: cartInclude }));
}

async function setCartVariant(db, userId, variantId, quantity) {
  const variant = await db.productVariant.findFirst({ where: { id: variantId, active: true, product: { status: 'ACTIVE', deletedAt: null, store: { status: 'ACTIVE' } } }, include: { inventory: true } });
  if (!variant) throw notFound('Product variant');
  if (!variant.inventory || variant.inventory.onHand - variant.inventory.reserved < quantity) throw badRequest('INSUFFICIENT_STOCK', 'The requested quantity is not currently available.');
  const cart = await db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.cartItem.upsert({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } }, update: { quantity }, create: { cartId: cart.id, variantId: variant.id, quantity } });
  return getCart(db, userId);
}

export function createAccountRouter() {
  const router = Router();
  router.get('/auth/me', ...requireAuth(), (req, res) => success(res, userSummary(req.user)));
  router.get('/account/profile', ...requireAuth(), (req, res) => success(res, { id: req.user.id, email: req.user.email, status: req.user.status, profile: req.user.profile || null, roles: req.user.platformRoles?.map((assignment) => assignment.role) || [] }));
  router.patch('/account/profile', ...requireAuth(), validate(z.object({ displayName: z.string().trim().min(1).max(120).optional(), firstName: z.string().trim().max(80).optional().nullable(), lastName: z.string().trim().max(80).optional().nullable(), phone: z.string().trim().max(30).optional().nullable(), avatarId: uuid.optional().nullable(), location: z.string().trim().max(160).optional().nullable() })), asyncRoute(async (req, res) => {
    if (req.body.avatarId) {
      const asset = await req.db.mediaAsset.findFirst({ where: { id: req.body.avatarId, ownerId: req.user.id, access: 'PUBLIC', kind: 'IMAGE' } });
      if (!asset) throw badRequest('INVALID_AVATAR', 'Select an image you uploaded.');
    }
    const profile = await req.db.userProfile.upsert({ where: { userId: req.user.id }, update: req.body, create: { userId: req.user.id, ...req.body } });
    return success(res, profile);
  }));
  router.get('/account/addresses', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.address.findMany({ where: { userId: req.user.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }))));
  router.post('/account/addresses', ...requireAuth(), validate(addressSchema), asyncRoute(async (req, res) => {
    const address = await req.db.$transaction(async (tx) => {
      if (req.body.isDefault) await tx.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
      return tx.address.create({ data: { userId: req.user.id, ...req.body } });
    });
    return created(res, address);
  }));
  router.patch('/account/addresses/:id', ...requireAuth(), validate(addressSchema.partial()), asyncRoute(async (req, res) => {
    const current = await req.db.address.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!current) throw notFound('Address');
    const address = await req.db.$transaction(async (tx) => {
      if (req.body.isDefault) await tx.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
      return tx.address.update({ where: { id: current.id }, data: req.body });
    });
    return success(res, address);
  }));
  router.delete('/account/addresses/:id', ...requireAuth(), asyncRoute(async (req, res) => {
    const removed = await req.db.address.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!removed.count) throw notFound('Address');
    return success(res, { deleted: true });
  }));

  router.get('/cart', ...requireAuth(), asyncRoute(async (req, res) => success(res, await getCart(req.db, req.user.id))));
  router.post('/cart/items', ...requireAuth(), validate(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99).default(1) })), asyncRoute(async (req, res) => success(res, await setCartVariant(req.db, req.user.id, req.body.variantId, req.body.quantity))));
  router.put('/cart/items/:variantId', ...requireAuth(), validate(z.object({ quantity: z.number().int().min(1).max(99) })), asyncRoute(async (req, res) => {
    return success(res, await setCartVariant(req.db, req.user.id, req.params.variantId, req.body.quantity));
  }));
  router.patch('/cart/items/:id', ...requireAuth(), validate(z.object({ quantity: z.number().int().min(1).max(99) })), asyncRoute(async (req, res) => {
    const cart = await req.db.cart.findUnique({ where: { userId: req.user.id } });
    const item = cart ? await req.db.cartItem.findFirst({ where: { id: req.params.id, cartId: cart.id } }) : null;
    if (!item) throw notFound('Cart item');
    return success(res, await setCartVariant(req.db, req.user.id, item.variantId, req.body.quantity));
  }));
  router.delete('/cart/items/:variantId', ...requireAuth(), asyncRoute(async (req, res) => {
    const cart = await req.db.cart.findUnique({ where: { userId: req.user.id } });
    if (cart) await req.db.cartItem.deleteMany({ where: { cartId: cart.id, OR: [{ id: req.params.variantId }, { variantId: req.params.variantId }] } });
    return success(res, await getCart(req.db, req.user.id));
  }));
  router.delete('/cart/items/by-id/:id', ...requireAuth(), asyncRoute(async (req, res) => {
    const cart = await req.db.cart.findUnique({ where: { userId: req.user.id } });
    if (cart) await req.db.cartItem.deleteMany({ where: { id: req.params.id, cartId: cart.id } });
    return success(res, await getCart(req.db, req.user.id));
  }));

  router.get('/wishlist', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.wishlist.findFirst({ where: { userId: req.user.id, isDefault: true }, include: { items: { include: { product: { include: { media: { include: { asset: true }, orderBy: { sortOrder: 'asc' }, take: 1 }, variants: { where: { active: true }, take: 1 } } } } } } }))));
  router.put('/wishlist/:productId', ...requireAuth(), asyncRoute(async (req, res) => {
    const product = await req.db.product.findFirst({ where: { id: req.params.productId, status: 'ACTIVE', deletedAt: null } });
    if (!product) throw notFound('Product');
    let wishlist = await req.db.wishlist.findFirst({ where: { userId: req.user.id, isDefault: true } });
    if (!wishlist) wishlist = await req.db.wishlist.create({ data: { userId: req.user.id } });
    await req.db.wishlistItem.upsert({ where: { wishlistId_productId: { wishlistId: wishlist.id, productId: product.id } }, update: {}, create: { wishlistId: wishlist.id, productId: product.id } });
    return success(res, { saved: true });
  }));
  router.delete('/wishlist/:productId', ...requireAuth(), asyncRoute(async (req, res) => {
    const wishlist = await req.db.wishlist.findFirst({ where: { userId: req.user.id, isDefault: true } });
    if (wishlist) await req.db.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id, productId: req.params.productId } });
    return success(res, { deleted: true });
  }));

  router.get('/notifications', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 }))));
  router.patch('/notifications/:id/read', ...requireAuth(), asyncRoute(async (req, res) => {
    const changed = await req.db.notification.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { readAt: new Date() } });
    if (!changed.count) throw notFound('Notification');
    return success(res, { read: true });
  }));
  router.get('/account/notification-preferences', ...requireAuth(), asyncRoute(async (req, res) => success(res, await req.db.notificationPreference.findUnique({ where: { userId: req.user.id } }))));
  router.put('/account/notification-preferences', ...requireAuth(), validate(z.object({ emailOrderUpdates: z.boolean(), pushMessages: z.boolean(), marketingEmail: z.boolean() })), asyncRoute(async (req, res) => success(res, await req.db.notificationPreference.upsert({ where: { userId: req.user.id }, update: req.body, create: { userId: req.user.id, ...req.body } }))));
  router.post('/account/push-subscriptions', ...requireAuth(), validate(z.object({ endpoint: z.string().url().max(2048), p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512), provider: z.string().max(60).optional(), deviceMeta: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (req, res) => created(res, await req.db.pushSubscription.upsert({ where: { userId_endpoint: { userId: req.user.id, endpoint: req.body.endpoint } }, update: { ...req.body, lastUsedAt: new Date() }, create: { userId: req.user.id, ...req.body } }))));
  return router;
}
