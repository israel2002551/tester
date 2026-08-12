import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';

export const referralsRouter = Router();
referralsRouter.use(requireAuth);
referralsRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM referrals WHERE referrer_id=$1 ORDER BY created_at DESC LIMIT 200', [req.user.id]);
  const totals = rows.reduce((acc,row) => {
    acc.total += Number(row.amount || 0);
    if (row.paid) acc.paid += Number(row.amount || 0); else acc.pending += Number(row.amount || 0);
    return acc;
  }, { total:0, paid:0, pending:0 });
  res.json({ items: rows, totals });
}));
