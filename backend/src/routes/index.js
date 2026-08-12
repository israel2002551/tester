import { Router } from 'express';
import { attachDatabase } from '../auth/middleware.js';
import { createAccountRouter } from './account.js';
import { createAdminRouter } from './admin.js';
import { createCatalogRouter } from './catalog.js';
import { createCommerceRouter } from './commerce.js';
import { createCommunityRouter } from './community.js';
import { createMediaRouter } from './media.js';
import { createOperationsRouter } from './operations.js';
import { createSellerRouter } from './seller.js';
import { createSourcingRouter } from './sourcing.js';
import { createSupplierRouter } from './supplier.js';

export function createApiRouter({ db }) {
  const router = Router();
  router.use(attachDatabase(db));
  router.use(createCatalogRouter());
  router.use('/catalog', createCatalogRouter());
  router.use(createCommerceRouter());
  router.use(createAccountRouter());
  router.use('/seller', createSellerRouter());
  router.use('/supplier', createSupplierRouter());
  router.use('/sourcing', createSourcingRouter());
  router.use('/admin', createAdminRouter());
  router.use(createCommunityRouter());
  router.use(createOperationsRouter());
  router.use('/media', createMediaRouter());
  return router;
}
