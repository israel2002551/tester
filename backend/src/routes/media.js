import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { hasPlatformPermission } from '../auth/permissions.js';
import { asyncRoute, created, success } from '../lib/http.js';
import { uuid } from '../lib/validation.js';
import { validate } from '../middleware/validate.js';
import { assetAccessUrl, authorizeUpload, registerAsset } from '../services/media.js';

const baseFile = z.object({ kind: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT']), mimeType: z.string().trim().min(3).max(120), bytes: z.number().int().positive() });

export function createMediaRouter() {
  const router = Router();
  router.use(...requireAuth());
  router.post('/uploads/authorize', validate(baseFile.extend({ filename: z.string().trim().min(1).max(240), purpose: z.enum(['avatar', 'product', 'message', 'sourcing', 'service', 'kyc', 'dispute']), access: z.enum(['PUBLIC', 'PRIVATE']) })), asyncRoute(async (req, res) => success(res, await authorizeUpload(req.user.id, req.body))));
  router.post('/assets', validate(baseFile.extend({ provider: z.enum(['s3', 'cloudinary']), providerAssetId: z.string().trim().min(1).max(1000), providerVersion: z.coerce.number().int().positive().optional(), providerSignature: z.string().regex(/^[a-f0-9]{40}$/i).optional(), access: z.enum(['PUBLIC', 'PRIVATE']), publicUrl: z.string().url().max(2048).optional().nullable(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationMs: z.number().int().positive().optional() }).superRefine((value, context) => { if (value.provider === 'cloudinary' && (!value.providerVersion || !value.providerSignature)) context.addIssue({ code: 'custom', message: 'Cloudinary version and response signature are required.' }); })), asyncRoute(async (req, res) => created(res, await registerAsset(req.db, req.user.id, req.body))));
  router.get('/assets/:id/access', validate(z.object({ id: uuid }), 'params'), asyncRoute(async (req, res) => {
    const asset = await req.db.mediaAsset.findUnique({ where: { id: req.params.id }, select: { ownerId: true, access: true } });
    let privileged = asset?.ownerId === req.user.id || asset?.access === 'PUBLIC';
    if (!privileged && asset) {
      const [message, kyc, evidence, sourcing] = await Promise.all([
        req.db.message.findFirst({ where: { mediaAssetId: req.params.id, conversation: { members: { some: { userId: req.user.id } } } }, select: { id: true } }),
        hasPlatformPermission(req.user, 'kyc.read') ? req.db.kycDocument.findFirst({ where: { mediaAssetId: req.params.id }, select: { id: true } }) : null,
        req.db.disputeEvidence.findFirst({ where: { mediaAssetId: req.params.id, dispute: hasPlatformPermission(req.user, 'disputes.read') ? {} : { OR: [{ openedById: req.user.id }, { order: { buyerId: req.user.id } }, { order: { storeOrders: { some: { store: { memberships: { some: { userId: req.user.id, status: 'ACTIVE' } } } } } } }] } }, select: { id: true } }),
        req.db.sourcingItem.findFirst({ where: { imageAssetId: req.params.id, request: hasPlatformPermission(req.user, 'sourcing.internal.read') ? {} : { requesterId: req.user.id } }, select: { id: true } }),
      ]);
      privileged = Boolean(message || kyc || evidence || sourcing);
    }
    return success(res, await assetAccessUrl(req.db, req.user, req.params.id, { privileged }));
  }));
  return router;
}
