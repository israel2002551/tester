import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  ['phones-tablets', 'Phones & Tablets', 'Smartphones, tablets and mobile accessories'],
  ['electronics', 'Electronics', 'TV, audio, computing and smart devices'],
  ['fashion', 'Fashion', 'Clothing, shoes, bags and accessories'],
  ['home-living', 'Home & Living', 'Furniture, appliances and everyday home essentials'],
  ['beauty-health', 'Beauty & Health', 'Beauty, wellness and personal care'],
  ['sports-outdoors', 'Sports & Outdoors', 'Fitness, sports and outdoor equipment'],
  ['automotive', 'Automotive', 'Vehicle parts, accessories and tools'],
  ['baby-kids', 'Baby & Kids', 'Clothing, toys and essentials for children'],
];

const demoProducts = [
  ['ora-x1-phone', 'Ora X1 5G Smartphone', 'phones-tablets', 'BUY-ORA-X1', 289_900_00n, 18, 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=85'],
  ['wireless-noise-cancelling-headphones', 'Wireless Noise-Cancelling Headphones', 'electronics', 'BUY-AUDIO-40', 84_500_00n, 35, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85'],
  ['essential-leather-tote', 'Essential Leather Tote', 'fashion', 'BUY-TOTE-02', 39_800_00n, 22, 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85'],
  ['compact-air-fryer', 'Compact Digital Air Fryer', 'home-living', 'BUY-AIR-32', 67_000_00n, 14, 'https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=900&q=85'],
  ['everyday-runner', 'Everyday Runner Sneakers', 'fashion', 'BUY-RUN-11', 46_500_00n, 28, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85'],
  ['smart-watch-active', 'Active Smart Watch', 'electronics', 'BUY-WATCH-8', 58_900_00n, 31, 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85'],
  ['botanical-skin-set', 'Botanical Skin Care Set', 'beauty-health', 'BUY-SKIN-07', 24_750_00n, 44, 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=900&q=85'],
  ['adjustable-dumbbell-set', 'Adjustable Dumbbell Set', 'sports-outdoors', 'BUY-FIT-24', 73_500_00n, 12, 'https://images.unsplash.com/photo-1638536532686-d610adfc8e5c?auto=format&fit=crop&w=900&q=85'],
];

async function seedBaseline() {
  for (const [slug, name, description] of categories) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, description, active: true },
      create: { slug, name, description, sortOrder: categories.findIndex(([item]) => item === slug) },
    });
  }
}

async function seedDemo() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo data is prohibited when NODE_ENV=production.');
  }

  const operator = await prisma.user.upsert({
    where: { email: 'operator@demo.buysell.ng' },
    update: {},
    create: {
      email: 'operator@demo.buysell.ng',
      profile: { create: { displayName: 'BUYSELL Demo Operator', firstName: 'Demo', lastName: 'Operator' } },
    },
  });

  await prisma.authIdentity.upsert({
    where: { provider_providerSubject: { provider: 'IMPORTED', providerSubject: 'demo-operator' } },
    update: { userId: operator.id },
    create: { userId: operator.id, provider: 'IMPORTED', providerSubject: 'demo-operator', providerEmail: operator.email },
  });
  await prisma.platformRoleAssignment.upsert({
    where: { userId_role: { userId: operator.id, role: 'SUPER_ADMIN' } },
    update: {},
    create: { userId: operator.id, role: 'SUPER_ADMIN' },
  });

  const store = await prisma.store.upsert({
    where: { slug: 'buywell-electronics' },
    update: { status: 'ACTIVE' },
    create: {
      ownerId: operator.id,
      slug: 'buywell-electronics',
      name: 'Buywell Select',
      description: 'Verified everyday technology, fashion and home essentials.',
      status: 'ACTIVE',
      location: 'Lagos, Nigeria',
      memberships: { create: { userId: operator.id, role: 'OWNER' } },
      ledgerAccount: { create: { currency: 'NGN' } },
    },
  });

  for (const [slug, name, categorySlug, sku, priceKobo, onHand, imageUrl] of demoProducts) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: categorySlug } });
    const product = await prisma.product.upsert({
      where: { storeId_slug: { storeId: store.id, slug } },
      update: { name, status: 'ACTIVE', categoryId: category.id, publishedAt: new Date() },
      create: {
        storeId: store.id,
        categoryId: category.id,
        slug,
        name,
        description: `${name} from a verified BUYSELL seller, with protected checkout and delivery support.`,
        status: 'ACTIVE',
        shippingFeeKobo: 2_500_00n,
        publishedAt: new Date(),
      },
    });
    const variant = await prisma.productVariant.upsert({
      where: { productId_sku: { productId: product.id, sku } },
      update: { priceKobo, active: true },
      create: { productId: product.id, sku, name: 'Standard', priceKobo, inventory: { create: { onHand, reorderPoint: 5 } } },
    });
    await prisma.inventoryItem.upsert({
      where: { variantId: variant.id },
      update: { onHand },
      create: { variantId: variant.id, onHand, reorderPoint: 5 },
    });
    const asset = await prisma.mediaAsset.upsert({
      where: { providerAssetId: `demo:${slug}` },
      update: { publicUrl: imageUrl },
      create: {
        ownerId: operator.id,
        provider: 'remote-demo',
        providerAssetId: `demo:${slug}`,
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        bytes: 0,
        access: 'PUBLIC',
        publicUrl: imageUrl,
        metadata: { seedOnly: true, alt: name },
      },
    });
    await prisma.productMedia.upsert({
      where: { productId_assetId: { productId: product.id, assetId: asset.id } },
      update: { sortOrder: 0 },
      create: { productId: product.id, assetId: asset.id, sortOrder: 0 },
    });
  }
}

try {
  await seedBaseline();
  if (process.env.SEED_DEMO_DATA === 'true') await seedDemo();
  console.log(`BUYSELL seed complete (${process.env.SEED_DEMO_DATA === 'true' ? 'baseline + demo' : 'baseline only'}).`);
} finally {
  await prisma.$disconnect();
}
