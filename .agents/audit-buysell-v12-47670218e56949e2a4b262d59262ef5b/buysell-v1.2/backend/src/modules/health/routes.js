import { Router } from 'express';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../utils/http.js';
export const healthRouter = Router();
healthRouter.get('/', asyncHandler(async (_req,res) => {
  const { rows } = await query('SELECT now() AS now');
  res.json({ ok:true, service:'buysell-api', version:'1.2.0', database:true, time:rows[0].now });
}));
