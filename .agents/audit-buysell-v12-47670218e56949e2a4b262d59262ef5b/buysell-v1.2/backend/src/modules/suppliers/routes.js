import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requireRole('supplier','admin'));

async function ownProfile(req) {
  const userId = req.user.roles.includes('admin') && req.query.user_id ? req.query.user_id : req.user.id;
  const { rows } = await query('SELECT * FROM supplier_profiles WHERE user_id=$1', [userId]);
  return rows[0] || null;
}

suppliersRouter.get('/profile', asyncHandler(async(req,res)=>res.json((await ownProfile(req)) || {})));
suppliersRouter.put('/profile', asyncHandler(async(req,res)=>{
  const userId=req.user.roles.includes('admin')&&req.body.user_id?req.body.user_id:req.user.id;
  const key=String(req.body.supplier_key||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-');
  if(!key)throw new HttpError(400,'supplier_key is required');
  const {rows}=await query(`INSERT INTO supplier_profiles(user_id,supplier_key,business_name,description,contact_phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET supplier_key=EXCLUDED.supplier_key,business_name=EXCLUDED.business_name,description=EXCLUDED.description,contact_phone=EXCLUDED.contact_phone RETURNING *`,[userId,key,req.body.business_name||null,req.body.description||null,req.body.contact_phone||null]);
  await query('UPDATE supplier_connections SET supplier_user_id=$1 WHERE lower(supplier_key)=lower($2)',[userId,key]);
  res.json(rows[0]);
}));

suppliersRouter.get('/dashboard', asyncHandler(async(req,res)=>{
  const p=await ownProfile(req);if(!p)return res.json({profile_required:true,catalog:0,connections:0,orders:0,revenue:0});
  const [catalog,connections,orders]=await Promise.all([
    query('SELECT count(*)::int n FROM dropship_catalog WHERE lower(supplier_key)=lower($1)',[p.supplier_key]),
    query("SELECT count(*)::int n FROM supplier_connections WHERE supplier_user_id=$1 OR lower(supplier_key)=lower($2)",[p.user_id,p.supplier_key]),
    query(`SELECT count(DISTINCT o.id)::int orders,COALESCE(sum(oi.unit_price*oi.quantity),0)::bigint revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products pr ON pr.id=oi.product_id WHERE lower(COALESCE(pr.metadata->>'supplier_key',''))=lower($1)`,[p.supplier_key])
  ]);
  res.json({catalog:catalog.rows[0].n,connections:connections.rows[0].n,orders:orders.rows[0].orders,revenue:orders.rows[0].revenue,profile:p});
}));

suppliersRouter.get('/catalog', asyncHandler(async(req,res)=>{const p=await ownProfile(req);if(!p)return res.json([]);const {rows}=await query('SELECT * FROM dropship_catalog WHERE lower(supplier_key)=lower($1) ORDER BY created_at DESC',[p.supplier_key]);res.json(rows);}));
suppliersRouter.post('/catalog', asyncHandler(async(req,res)=>{const p=await ownProfile(req);if(!p)throw new HttpError(409,'Create your supplier profile first');const {rows}=await query('INSERT INTO dropship_catalog(supplier_key,external_id,name,description,niche,cost,suggested_price,shipping,image,images,stock,source_url,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[p.supplier_key,req.body.external_id||null,req.body.name,req.body.description||'',req.body.niche||null,Number(req.body.cost||0),Number(req.body.suggested_price||0),Number(req.body.shipping||0),req.body.image||null,JSON.stringify(req.body.images||[]),req.body.stock??999,req.body.source_url||null,JSON.stringify(req.body.payload||{})]);res.status(201).json(rows[0]);}));
suppliersRouter.get('/connections', asyncHandler(async(req,res)=>{const p=await ownProfile(req);if(!p)return res.json([]);const {rows}=await query(`SELECT sc.*,pr.name seller_name,pr.store_name,u.email seller_email FROM supplier_connections sc JOIN users u ON u.id=sc.seller_id LEFT JOIN profiles pr ON pr.user_id=sc.seller_id WHERE sc.supplier_user_id=$1 OR lower(sc.supplier_key)=lower($2) ORDER BY sc.created_at DESC`,[p.user_id,p.supplier_key]);res.json(rows);}));
suppliersRouter.get('/orders', asyncHandler(async(req,res)=>{const p=await ownProfile(req);if(!p)return res.json([]);const {rows}=await query(`SELECT DISTINCT o.* FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products pr ON pr.id=oi.product_id WHERE lower(COALESCE(pr.metadata->>'supplier_key',''))=lower($1) ORDER BY o.created_at DESC LIMIT 200`,[p.supplier_key]);res.json(rows);}));
