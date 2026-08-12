import { notFound } from '../lib/errors.js';

export const publicProductInclude = {
  store: { select: { id: true, slug: true, name: true, logo: { select: { publicUrl: true } } } },
  category: { select: { id: true, slug: true, name: true } },
  brand: { select: { id: true, slug: true, name: true, logo: { select: { publicUrl: true } } } },
  variants: { where: { active: true }, include: { inventory: true, optionValues: { include: { value: { include: { option: true } } } } } },
  media: { orderBy: { sortOrder: 'asc' }, include: { asset: true } },
};

export function publicProduct(product, ratingSummary) {
  const media = (product.media || [])
    .filter((item) => item.asset.access === 'PUBLIC' && item.asset.publicUrl)
    .map((item) => ({ id: item.asset.id, kind: item.asset.kind, url: item.asset.publicUrl, width: item.asset.width, height: item.asset.height }));
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    condition: product.condition,
    shippingFeeKobo: product.shippingFeeKobo,
    negotiable: product.negotiable,
    publishedAt: product.publishedAt,
    store: product.store && { id: product.store.id, slug: product.store.slug, name: product.store.name, logoUrl: product.store.logo?.publicUrl || null },
    category: product.category,
    brand: product.brand && { id: product.brand.id, slug: product.brand.slug, name: product.brand.name, logoUrl: product.brand.logo?.publicUrl || null },
    media,
    variants: (product.variants || []).map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceKobo: variant.priceKobo,
      compareAtKobo: variant.compareAtKobo,
      attributes: variant.attributes,
      available: Math.max(0, (variant.inventory?.onHand || 0) - (variant.inventory?.reserved || 0)),
      options: variant.optionValues?.map(({ value }) => ({ name: value.option.name, value: value.value })) || [],
    })),
    rating: ratingSummary?._avg?.rating ?? null,
    reviewCount: ratingSummary?._count?.rating ?? 0,
  };
}

async function ratingsFor(db, productIds) {
  if (!productIds.length) return new Map();
  const rows = await db.review.groupBy({ by: ['productId'], where: { productId: { in: productIds }, status: 'PUBLISHED' }, _avg: { rating: true }, _count: { rating: true } });
  return new Map(rows.map((row) => [row.productId, row]));
}

export async function listProducts(db, query, { skip, limit }) {
  const where = {
    status: 'ACTIVE', deletedAt: null, store: { status: 'ACTIVE' },
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(query.store ? { store: { slug: query.store, status: 'ACTIVE' } } : {}),
    ...(query.brand ? { brand: { slug: query.brand } } : {}),
    ...(query.condition ? { condition: query.condition } : {}),
    ...((query.minPriceKobo !== undefined || query.maxPriceKobo !== undefined) ? { variants: { some: { active: true, priceKobo: { ...(query.minPriceKobo !== undefined ? { gte: BigInt(query.minPriceKobo) } : {}), ...(query.maxPriceKobo !== undefined ? { lte: BigInt(query.maxPriceKobo) } : {}) } } } } : {}),
    ...(query.q ? { OR: [
      { name: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
      { brand: { name: { contains: query.q, mode: 'insensitive' } } },
    ] } : {}),
  };
  const orderBy = query.sort === 'oldest' ? { createdAt: 'asc' } : query.sort === 'name' ? { name: 'asc' } : { publishedAt: 'desc' };
  const [products, total] = await Promise.all([
    db.product.findMany({ where, include: publicProductInclude, orderBy, skip, take: limit }),
    db.product.count({ where }),
  ]);
  const ratings = await ratingsFor(db, products.map((product) => product.id));
  return { products: products.map((product) => publicProduct(product, ratings.get(product.id))), total };
}

export async function getProduct(db, identifier) {
  const where = /^[0-9a-f-]{36}$/i.test(identifier) ? { id: identifier } : { slug: identifier };
  const product = await db.product.findFirst({ where: { ...where, status: 'ACTIVE', deletedAt: null, store: { status: 'ACTIVE' } }, include: publicProductInclude });
  if (!product) throw notFound('Product');
  const ratings = await ratingsFor(db, [product.id]);
  return publicProduct(product, ratings.get(product.id));
}
