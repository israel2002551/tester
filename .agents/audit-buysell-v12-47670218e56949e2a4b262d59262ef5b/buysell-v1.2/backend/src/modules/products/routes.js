import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';

export const productsRouter = Router();

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().default(''),
  price: z.number().int().nonnegative(),
  original_price: z.number().int().nonnegative().nullable().optional(),
  shipping_fee: z.number().int().nonnegative().optional().default(0),
  category: z.string().optional(),
  condition: z.string().optional(),
  location: z.string().optional(),
  images: z.array(z.string()).optional().default([]),
  videos: z.array(z.string()).optional().default([]),
  image_url: z.string().nullable().optional(),
  video_url: z.string().nullable().optional(),
  stock_quantity: z.number().int().nonnegative().optional().default(0),
  status: z.enum(['draft','active','paused','archived']).optional().default('draft'),
  negotiable: z.boolean().optional().default(false),
  flash_price: z.number().int().nonnegative().nullable().optional(),
  flash_end: z.string().nullable().optional(),
  low_stock_alert: z.number().int().nonnegative().optional().default(3),
});

async function canManageSeller(user, sellerId, permission = 'products') {
  if (!user || !sellerId) return false;
  if (user.roles.includes('admin') || user.id === sellerId) return true;
  if (!user.roles.includes('seller_manager')) return false;
  const { rows } = await query(`
    SELECT permissions FROM seller_manager_assignments
    WHERE seller_id=$1 AND manager_id=$2 AND status='active'
  `, [sellerId, user.id]);
  const perms = rows[0]?.permissions || {};
  return Boolean(perms[permission]);
}

productsRouter.get('/', optionalAuth, asyncHandler(async (req,res) => {
  const limit = Math.min(Number(req.query.limit || 40), 100);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const p = [];
  const where = [];
  const mine = String(req.query.mine || '') === '1';

  if (mine) {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    if (req.user.roles.includes('admin') && req.query.seller) {
      p.push(req.query.seller); where.push(`p.seller_id=$${p.length}`);
    } else if (req.user.roles.includes('seller_manager')) {
      p.push(req.user.id);
      where.push(`p.seller_id IN (SELECT seller_id FROM seller_manager_assignments WHERE manager_id=$${p.length} AND status='active' AND COALESCE((permissions->>'products')::boolean,false)=true)`);
    } else {
      p.push(req.user.id); where.push(`p.seller_id=$${p.length}`);
    }
  } else {
    where.push("p.status='active'");
    if (req.query.seller) { p.push(req.query.seller); where.push(`p.seller_id=$${p.length}`); }
  }
  if (req.query.category) { p.push(req.query.category); where.push(`p.category=$${p.length}`); }
  if (req.query.q) { p.push(`%${req.query.q}%`); where.push(`(p.name ILIKE $${p.length} OR p.description ILIKE $${p.length} OR p.category ILIKE $${p.length})`); }
  p.push(limit, offset);
  const { rows } = await query(`
    SELECT p.*,pr.name seller_name,pr.store_name,prs.average_rating,prs.review_count
    FROM products p
    LEFT JOIN profiles pr ON pr.user_id=p.seller_id
    LEFT JOIN product_rating_summary prs ON prs.product_id=p.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.created_at DESC LIMIT $${p.length-1} OFFSET $${p.length}
  `, p);
  res.json({ items: rows, limit, offset });
}));

productsRouter.get('/:id', optionalAuth, asyncHandler(async(req,res) => {
  const {rows}=await query(`SELECT p.*,pr.name seller_name,pr.store_name,pr.store_description,pr.logo_url,prs.average_rating,prs.review_count FROM products p LEFT JOIN profiles pr ON pr.user_id=p.seller_id LEFT JOIN product_rating_summary prs ON prs.product_id=p.id WHERE p.id=$1`,[req.params.id]);
  const product = rows[0];
  if(!product) throw new HttpError(404,'Product not found');
  if (product.status !== 'active' && !(await canManageSeller(req.user, product.seller_id))) throw new HttpError(404,'Product not found');
  res.json(product);
}));

productsRouter.post('/', requireAuth, requireRole('seller','seller_manager','admin'), asyncHandler(async(req,res) => {
  const d=productSchema.parse(req.body);
  let sellerId=req.user.id;
  if (req.user.roles.includes('admin') && req.body.seller_id) sellerId=req.body.seller_id;
  if (req.user.roles.includes('seller_manager')) {
    if (!req.body.seller_id) throw new HttpError(400, 'seller_id is required for seller managers');
    if (!(await canManageSeller(req.user, req.body.seller_id))) throw new HttpError(403, 'Manager is not assigned to this seller');
    sellerId=req.body.seller_id;
  }
  const {rows}=await query(`INSERT INTO products(seller_id,name,description,price,original_price,shipping_fee,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,negotiable,flash_price,flash_end,low_stock_alert) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,[sellerId,d.name,d.description,d.price,d.original_price??null,d.shipping_fee,d.category||null,d.condition||null,d.location||null,JSON.stringify(d.images),JSON.stringify(d.videos),d.image_url||d.images[0]||null,d.video_url||d.videos[0]||null,d.videos.length>0,d.stock_quantity,d.status,d.negotiable,d.flash_price??null,d.flash_end||null,d.low_stock_alert]);
  res.status(201).json(rows[0]);
}));

productsRouter.patch('/:id', requireAuth, requireRole('seller','seller_manager','admin'), asyncHandler(async(req,res) => {
  const {rows:[current]}=await query('SELECT * FROM products WHERE id=$1',[req.params.id]);
  if(!current) throw new HttpError(404,'Product not found');
  if (!(await canManageSeller(req.user, current.seller_id))) throw new HttpError(403,'Not permitted to manage this product');
  const allowed=['name','description','price','original_price','shipping_fee','category','condition','location','images','videos','image_url','video_url','stock_quantity','status','negotiable','flash_price','flash_end','low_stock_alert'];
  const entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));
  if(!entries.length) return res.json(current);
  const values=entries.map(([,v])=>Array.isArray(v)||(typeof v==='object'&&v!==null)?JSON.stringify(v):v);
  values.push(req.params.id);
  const sets=entries.map(([k],i)=>`${k}=$${i+1}`);
  const {rows}=await query(`UPDATE products SET ${sets.join(',')},has_video=COALESCE(jsonb_array_length(videos),0)>0 WHERE id=$${values.length} RETURNING *`,values);
  res.json(rows[0]);
}));

productsRouter.delete('/:id', requireAuth, requireRole('seller','seller_manager','admin'), asyncHandler(async(req,res) => {
  const {rows:[current]}=await query('SELECT seller_id FROM products WHERE id=$1',[req.params.id]);
  if(!current) throw new HttpError(404,'Product not found');
  if (!(await canManageSeller(req.user, current.seller_id))) throw new HttpError(403,'Not permitted to delete this product');
  await query('DELETE FROM products WHERE id=$1',[req.params.id]);
  res.status(204).end();
}));
