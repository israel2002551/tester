import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { conflict, notFound } from '../lib/errors.js';
import { asyncRoute, created, pageMeta, pagination, success } from '../lib/http.js';
import { slugify } from '../lib/ids.js';
import { cleanText, moneyString } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';

async function activeSupplier(req) {
  const supplier = await req.db.supplierProfile.findUnique({ where: { userId: req.user.id } });
  if (!supplier) throw notFound('Supplier profile');
  if (supplier.status !== 'ACTIVE') throw conflict('SUPPLIER_NOT_ACTIVE', 'Your supplier profile must be approved before using this feature.');
  return supplier;
}

export function createSupplierRouter() {
  const router = Router();
  router.use(...requireAuth());
  router.get('/profile', asyncRoute(async (req, res) => success(res, await req.db.supplierProfile.findUnique({ where: { userId: req.user.id } }))));
  router.post('/profile', validate(z.object({ displayName: cleanText(160), slug: z.string().trim().regex(/^[a-z0-9-]{3,72}$/).optional(), description: z.string().trim().max(5000).optional(), country: z.string().trim().max(100).optional(), contactEmail: z.string().email().optional() })), asyncRoute(async (req, res) => {
    const supplier = await req.db.supplierProfile.upsert({ where: { userId: req.user.id }, update: { ...req.body, status: 'PENDING' }, create: { userId: req.user.id, ...req.body, slug: req.body.slug || slugify(req.body.displayName) } });
    return created(res, supplier);
  }));
  router.get('/products', asyncRoute(async (req, res) => {
    const supplier = await activeSupplier(req);
    const page = pagination(req.query);
    const [products, total] = await Promise.all([
      req.db.supplierProduct.findMany({ where: { supplierId: supplier.id }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.supplierProduct.count({ where: { supplierId: supplier.id } }),
    ]);
    return success(res, products, pageMeta(page.page, page.limit, total));
  }));
  router.post('/products', validate(z.object({ sku: cleanText(80), name: cleanText(180), description: z.string().trim().max(10_000).optional(), costKobo: moneyString, suggestedKobo: moneyString.optional(), stockQuantity: z.number().int().nonnegative().optional(), sourceUrl: z.string().url().max(2048).optional(), metadata: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (req, res) => {
    const supplier = await activeSupplier(req);
    return created(res, await req.db.supplierProduct.create({ data: { supplierId: supplier.id, ...req.body, costKobo: BigInt(req.body.costKobo), suggestedKobo: req.body.suggestedKobo === undefined ? null : BigInt(req.body.suggestedKobo) } }));
  }));
  router.patch('/products/:id', validate(z.object({ name: cleanText(180).optional(), description: z.string().trim().max(10_000).optional().nullable(), costKobo: moneyString.optional(), suggestedKobo: moneyString.optional().nullable(), stockQuantity: z.number().int().nonnegative().optional().nullable(), sourceUrl: z.string().url().max(2048).optional().nullable(), active: z.boolean().optional(), metadata: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (req, res) => {
    const supplier = await activeSupplier(req);
    const product = await req.db.supplierProduct.findFirst({ where: { id: req.params.id, supplierId: supplier.id } });
    if (!product) throw notFound('Supplier product');
    const data = { ...req.body, ...(req.body.costKobo !== undefined ? { costKobo: BigInt(req.body.costKobo) } : {}), ...(req.body.suggestedKobo !== undefined ? { suggestedKobo: req.body.suggestedKobo === null ? null : BigInt(req.body.suggestedKobo) } : {}) };
    return success(res, await req.db.supplierProduct.update({ where: { id: product.id }, data }));
  }));
  router.get('/connections', asyncRoute(async (req, res) => {
    const supplier = await activeSupplier(req);
    return success(res, await req.db.supplierConnection.findMany({ where: { supplierId: supplier.id }, include: { store: { select: { id: true, name: true, slug: true, status: true } } }, orderBy: { createdAt: 'desc' } }));
  }));
  router.get('/rfqs', asyncRoute(async (req, res) => {
    const supplier = await activeSupplier(req);
    const page = pagination(req.query);
    const where = { status: { in: ['OPEN', 'QUOTING'] }, ...(req.query.q ? { title: { contains: req.query.q, mode: 'insensitive' } } : {}) };
    const [rfqs, total] = await Promise.all([
      req.db.rfqRequest.findMany({ where, include: { quotes: { where: { supplierId: supplier.id } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.rfqRequest.count({ where }),
    ]);
    return success(res, rfqs, pageMeta(page.page, page.limit, total));
  }));
  router.post('/rfqs/:id/quotes', validate(z.object({ unitPriceKobo: moneyString, shippingKobo: moneyString.default(0), leadTimeDays: z.number().int().positive().max(365), minimumOrderQty: z.number().int().positive().default(1), terms: z.string().trim().max(5000).optional(), expiresAt: z.coerce.date() })), asyncRoute(async (req, res) => {
    const supplier = await activeSupplier(req);
    const rfq = await req.db.rfqRequest.findFirst({ where: { id: req.params.id, status: { in: ['OPEN', 'QUOTING'] } } });
    if (!rfq) throw notFound('Open request for quote');
    if (req.body.expiresAt <= new Date()) throw conflict('INVALID_QUOTE_EXPIRY', 'Quote expiry must be in the future.');
    const quote = await req.db.$transaction(async (tx) => {
      const createdQuote = await tx.rfqQuote.upsert({ where: { requestId_supplierId: { requestId: rfq.id, supplierId: supplier.id } }, update: { ...req.body, unitPriceKobo: BigInt(req.body.unitPriceKobo), shippingKobo: BigInt(req.body.shippingKobo) }, create: { requestId: rfq.id, supplierId: supplier.id, ...req.body, unitPriceKobo: BigInt(req.body.unitPriceKobo), shippingKobo: BigInt(req.body.shippingKobo) } });
      if (rfq.status === 'OPEN') await tx.rfqRequest.update({ where: { id: rfq.id }, data: { status: 'QUOTING' } });
      return createdQuote;
    });
    return created(res, quote);
  }));
  return router;
}
