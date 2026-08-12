import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, pageMeta, pagination, success } from '../lib/http.js';
import { getProduct, listProducts, publicProductInclude, publicProduct } from '../services/catalog.js';
import { validate } from '../middleware/validate.js';

const querySchema = z.object({
  q: z.string().trim().max(120).optional(), category: z.string().trim().max(80).optional(), store: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(80).optional(), condition: z.enum(['NEW', 'USED', 'REFURBISHED']).optional(),
  minPriceKobo: z.coerce.number().int().nonnegative().optional(), maxPriceKobo: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(['relevance', 'newest', 'oldest', 'name']).default('relevance'), page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(),
});

export function createCatalogRouter() {
  const router = Router();
  const productList = asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const result = await listProducts(req.db, req.query, page);
    return success(res, result.products, pageMeta(page.page, page.limit, result.total));
  });
  router.get('/health', (_req, res) => success(res, { status: 'ok', service: 'buysell-api' }));
  router.get('/ready', asyncRoute(async (req, res) => {
    await req.db.$queryRaw`SELECT 1`;
    return success(res, { status: 'ready', database: 'reachable' });
  }));
  router.get('/categories', asyncRoute(async (req, res) => {
    const categories = await req.db.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { children: { where: { active: true }, orderBy: { sortOrder: 'asc' } } } });
    return success(res, categories.filter((category) => !category.parentId));
  }));
  router.get('/brands', asyncRoute(async (req, res) => success(res, await req.db.brand.findMany({ where: { active: true }, orderBy: { name: 'asc' }, include: { logo: { select: { publicUrl: true } } } }))));
  router.get('/products', validate(querySchema, 'query'), productList);
  router.get('/search', validate(querySchema, 'query'), productList);
  router.get('/products/:identifier', asyncRoute(async (req, res) => success(res, await getProduct(req.db, req.params.identifier))));
  router.get('/stores/:slug', asyncRoute(async (req, res) => {
    const store = await req.db.store.findFirst({ where: { slug: req.params.slug, status: 'ACTIVE' }, include: { logo: true, banner: true } });
    if (!store) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Store could not be found.' }, requestId: req.id });
    const page = pagination(req.query);
    const [products, total, ratings] = await Promise.all([
      req.db.product.findMany({ where: { storeId: store.id, status: 'ACTIVE', deletedAt: null }, include: publicProductInclude, orderBy: { publishedAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.product.count({ where: { storeId: store.id, status: 'ACTIVE', deletedAt: null } }),
      req.db.review.groupBy({ by: ['productId'], where: { product: { storeId: store.id }, status: 'PUBLISHED' }, _avg: { rating: true }, _count: { rating: true } }),
    ]);
    const ratingMap = new Map(ratings.map((row) => [row.productId, row]));
    return success(res, { store: { id: store.id, slug: store.slug, name: store.name, description: store.description, location: store.location, logoUrl: store.logo?.publicUrl, bannerUrl: store.banner?.publicUrl }, products: products.map((product) => publicProduct(product, ratingMap.get(product.id))) }, pageMeta(page.page, page.limit, total));
  }));
  router.get('/stores', asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const where = { status: 'ACTIVE', ...(req.query.q ? { name: { contains: req.query.q, mode: 'insensitive' } } : {}) };
    const [stores, total] = await Promise.all([
      req.db.store.findMany({ where, select: { id: true, slug: true, name: true, description: true, location: true, logo: { select: { publicUrl: true } }, banner: { select: { publicUrl: true } }, _count: { select: { products: { where: { status: 'ACTIVE', deletedAt: null } } } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      req.db.store.count({ where }),
    ]);
    return success(res, stores.map((store) => ({ ...store, logoUrl: store.logo?.publicUrl || null, bannerUrl: store.banner?.publicUrl || null, logo: undefined, banner: undefined })), pageMeta(page.page, page.limit, total));
  }));
  router.get('/home', asyncRoute(async (req, res) => {
    const [categories, productResult, campaigns] = await Promise.all([
      req.db.category.findMany({ where: { active: true, parentId: null }, orderBy: { sortOrder: 'asc' }, take: 12 }),
      listProducts(req.db, { sort: 'newest' }, { skip: 0, limit: 12 }),
      req.db.adCampaign.findMany({ where: { status: 'ACTIVE', startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, select: { id: true, placement: true, headline: true, body: true, destinationUrl: true, mediaAsset: { select: { publicUrl: true } } }, take: 8 }),
    ]);
    return success(res, { categories, products: productResult.products, campaigns });
  }));
  return router;
}
