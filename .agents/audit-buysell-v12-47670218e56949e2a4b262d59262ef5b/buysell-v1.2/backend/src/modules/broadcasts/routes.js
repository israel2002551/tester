import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';

export const broadcastsRouter = Router();
broadcastsRouter.use(requireAuth);
broadcastsRouter.get('/', asyncHandler(async (req, res) => {
  const targets = new Set(['all','users','everyone',...(req.user.roles || [])]);
  if ((req.user.roles || []).includes('buyer')) targets.add('buyers');
  if ((req.user.roles || []).includes('seller')) targets.add('sellers');
  if ((req.user.roles || []).includes('supplier')) targets.add('suppliers');
  if ((req.user.roles || []).includes('rider')) targets.add('riders');
  const values = [...targets];
  const { rows } = await query(`SELECT id,title,body,target,type,products,created_at FROM broadcast_jobs WHERE target=ANY($1::text[]) ORDER BY created_at DESC LIMIT 50`, [values]);
  res.json({ items: rows });
}));
