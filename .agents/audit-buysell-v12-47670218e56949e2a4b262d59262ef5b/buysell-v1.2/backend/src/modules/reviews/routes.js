import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler,HttpError } from '../../utils/http.js';
export const reviewsRouter=Router();
reviewsRouter.get('/product/:productId',asyncHandler(async(req,res)=>{const {rows}=await query('SELECT r.*,p.name reviewer_name,p.avatar_url FROM reviews r LEFT JOIN profiles p ON p.user_id=r.reviewer_id WHERE r.product_id=$1 ORDER BY r.created_at DESC LIMIT 50',[req.params.productId]);res.json(rows);}));
reviewsRouter.post('/',requireAuth,asyncHandler(async(req,res)=>{const d=z.object({product_id:z.uuid(),rating:z.number().int().min(1).max(5),comment:z.string().max(3000).optional().default('')}).parse(req.body);const purchase=await query("SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=$1 AND o.buyer_id=$2 AND o.status IN ('confirmed','shipped','delivered') LIMIT 1",[d.product_id,req.user.id]);const {rows}=await query(`INSERT INTO reviews(product_id,reviewer_id,buyer_id,rating,comment,review_text,verified_purchase) VALUES($1,$2,$2,$3,$4,$4,$5) ON CONFLICT(product_id,reviewer_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,review_text=EXCLUDED.review_text,verified_purchase=EXCLUDED.verified_purchase RETURNING *`,[d.product_id,req.user.id,d.rating,d.comment,purchase.rowCount>0]);res.status(201).json(rows[0]);}));
reviewsRouter.delete('/:id',requireAuth,asyncHandler(async(req,res)=>{const {rows}=await query('DELETE FROM reviews WHERE id=$1 AND reviewer_id=$2 RETURNING id',[req.params.id,req.user.id]);if(!rows[0])throw new HttpError(404,'Review not found');res.status(204).end();}));
