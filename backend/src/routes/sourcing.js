import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { asyncRoute, created, pageMeta, pagination, success } from '../lib/http.js';
import { cleanText, moneyString, optionalHttpUrl, uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';
import { acceptSourcingQuote, createSourcingRequest, getOwnSourcing, listOwnSourcing } from '../services/sourcing.js';

const createSchema = z.object({
  deliveryLocation: z.string().trim().max(300).optional(), desiredDeliveryAt: z.coerce.date().optional(), notes: z.string().trim().max(5000).optional(),
  items: z.array(z.object({ title: cleanText(200), description: z.string().trim().max(5000).optional(), specifications: z.record(z.string(), z.unknown()).optional(), quantity: z.number().int().positive().max(1_000_000), referenceUrl: optionalHttpUrl, imageAssetId: uuid.optional().nullable(), targetBudgetKobo: moneyString.optional() })).min(1).max(50),
});

export function createSourcingRouter() {
  const router = Router();
  router.use(...requireAuth());
  const list = asyncRoute(async (req, res) => {
    const page = pagination(req.query);
    const result = await listOwnSourcing(req.db, req.user.id, page);
    return success(res, result.requests, pageMeta(page.page, page.limit, result.total));
  });
  const create = asyncRoute(async (req, res) => created(res, await createSourcingRequest(req.db, req.user.id, req.body)));
  const detail = asyncRoute(async (req, res) => success(res, await getOwnSourcing(req.db, req.user.id, req.params.id)));
  const accept = asyncRoute(async (req, res) => success(res, await acceptSourcingQuote(req.db, req.user.id, req.params.id, req.params.quoteId)));
  router.get('/', list);
  router.post('/', validate(createSchema), create);
  router.get('/requests', list);
  router.post('/requests', validate(createSchema), create);
  router.get('/requests/:id', detail);
  router.post('/requests/:id/quotes/:quoteId/accept', accept);
  router.get('/:id', detail);
  router.post('/:id/quotes/:quoteId/accept', accept);
  return router;
}
