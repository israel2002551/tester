import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const collectionsRouter = Router();

const config = {
  wishlist: { table: 'wishlists' },
  compare: { table: 'compare_items' },
};

for (const [name, { table }] of Object.entries(config)) {
  collectionsRouter.get(`/${name}`, requireAuth, asyncHandler(async (req, res) => {
    const { rows } = await query(`
      SELECT p.*, pr.store_name, pr.name AS seller_name,
             prs.average_rating, prs.review_count, c.created_at AS saved_at
      FROM ${table} c
      JOIN products p ON p.id = c.product_id
      LEFT JOIN profiles pr ON pr.user_id = p.seller_id
      LEFT JOIN product_rating_summary prs ON prs.product_id = p.id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  }));

  collectionsRouter.post(`/${name}/:productId`, requireAuth, asyncHandler(async (req, res) => {
    const exists = await query('SELECT id FROM products WHERE id=$1', [req.params.productId]);
    if (!exists.rowCount) throw new HttpError(404, 'Product not found');
    await query(`INSERT INTO ${table}(user_id, product_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, req.params.productId]);
    res.status(201).json({ success: true });
  }));

  collectionsRouter.delete(`/${name}/:productId`, requireAuth, asyncHandler(async (req, res) => {
    await query(`DELETE FROM ${table} WHERE user_id=$1 AND product_id=$2`, [req.user.id, req.params.productId]);
    res.status(204).end();
  }));
}
