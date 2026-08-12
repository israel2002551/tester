import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const sellersRouter = Router();

async function assertManagerAssignment(managerId, sellerId, permission) {
  const { rows } = await query(`
    SELECT permissions FROM seller_manager_assignments
    WHERE manager_id=$1 AND seller_id=$2 AND status='active'
  `, [managerId, sellerId]);
  if (!rows[0]) throw new HttpError(403, 'Manager is not assigned to this seller');
  if (permission && !rows[0].permissions?.[permission]) throw new HttpError(403, `Manager lacks ${permission} permission`);
}

sellersRouter.get('/dashboard', requireAuth, requireRole('seller','seller_manager','admin'), asyncHandler(async(req,res) => {
  let seller = req.user.id;
  if (req.user.roles.includes('admin') && req.query.seller_id) seller = req.query.seller_id;
  if (req.user.roles.includes('seller_manager')) {
    if (!req.query.seller_id) throw new HttpError(400, 'seller_id is required for seller managers');
    await assertManagerAssignment(req.user.id, req.query.seller_id);
    seller = req.query.seller_id;
  }
  const [products,orders,revenue]=await Promise.all([
    query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='active')::int active FROM products WHERE seller_id=$1`,[seller]),
    query(`SELECT count(*)::int total,count(*) FILTER(WHERE status IN ('pending','confirmed','processing','shipped'))::int open FROM orders WHERE seller_id=$1`,[seller]),
    query('SELECT * FROM seller_revenue_summary WHERE seller_id=$1',[seller]),
  ]);
  res.json({products:products.rows[0],orders:orders.rows[0],revenue:revenue.rows[0]||{}});
}));

sellersRouter.get('/assignments', requireAuth, requireRole('seller_manager','admin'), asyncHandler(async(req,res) => {
  const admin=req.user.roles.includes('admin');
  const {rows}=await query(admin && req.query.manager_id
    ? `SELECT sma.*,p.name,p.store_name,p.logo_url,u.email FROM seller_manager_assignments sma JOIN users u ON u.id=sma.seller_id LEFT JOIN profiles p ON p.user_id=sma.seller_id WHERE sma.manager_id=$1 AND sma.status='active'`
    : `SELECT sma.*,p.name,p.store_name,p.logo_url,u.email FROM seller_manager_assignments sma JOIN users u ON u.id=sma.seller_id LEFT JOIN profiles p ON p.user_id=sma.seller_id WHERE sma.manager_id=$1 AND sma.status='active'`,
    [admin && req.query.manager_id ? req.query.manager_id : req.user.id]);
  res.json(rows);
}));

sellersRouter.get('/team', requireAuth, requireRole('seller','admin'), asyncHandler(async(req,res) => {
  const seller=req.user.roles.includes('admin') && req.query.seller_id ? req.query.seller_id : req.user.id;
  const {rows}=await query(`SELECT sma.*,p.name,p.avatar_url,u.email FROM seller_manager_assignments sma JOIN users u ON u.id=sma.manager_id LEFT JOIN profiles p ON p.user_id=u.id WHERE sma.seller_id=$1 ORDER BY sma.created_at DESC`,[seller]);
  res.json(rows);
}));

sellersRouter.post('/team', requireAuth, requireRole('seller','admin'), asyncHandler(async(req,res) => {
  const seller=req.user.roles.includes('admin') && req.body.seller_id ? req.body.seller_id : req.user.id;
  const {rows:[user]}=await query('SELECT id FROM users WHERE lower(email)=lower($1)',[req.body.email]);
  if(!user) throw new HttpError(404,'Manager account not found');
  await query(`INSERT INTO user_roles(user_id,role) VALUES($1,'seller_manager') ON CONFLICT DO NOTHING`,[user.id]);
  const permissions={products:true,orders:true,customers:true,...(req.body.permissions||{})};
  const {rows}=await query(`INSERT INTO seller_manager_assignments(seller_id,manager_id,permissions,status) VALUES($1,$2,$3,'active') ON CONFLICT(seller_id,manager_id) DO UPDATE SET permissions=EXCLUDED.permissions,status='active' RETURNING *`,[seller,user.id,JSON.stringify(permissions)]);
  res.status(201).json(rows[0]);
}));

sellersRouter.delete('/team/:managerId', requireAuth, requireRole('seller','admin'), asyncHandler(async(req,res) => {
  const seller=req.user.roles.includes('admin') && req.query.seller_id ? req.query.seller_id : req.user.id;
  await query(`UPDATE seller_manager_assignments SET status='revoked' WHERE seller_id=$1 AND manager_id=$2`,[seller,req.params.managerId]);
  res.status(204).end();
}));

sellersRouter.get('/manager/dashboard', requireAuth, requireRole('seller_manager','admin'), asyncHandler(async(req,res)=>{
  const manager=req.user.roles.includes('admin')&&req.query.manager_id?req.query.manager_id:req.user.id;
  const {rows:assignments}=await query("SELECT seller_id,permissions FROM seller_manager_assignments WHERE manager_id=$1 AND status='active'",[manager]);
  const sellerIds=assignments.map(r=>r.seller_id);
  if(!sellerIds.length)return res.json({stores:0,products:0,orders:0,open_tasks:0});
  const [products,orders,tasks]=await Promise.all([
    query('SELECT count(*)::int n FROM products WHERE seller_id=ANY($1::uuid[])',[sellerIds]),
    query('SELECT count(*)::int n FROM orders WHERE seller_id=ANY($1::uuid[])',[sellerIds]),
    query("SELECT count(*)::int n FROM seller_manager_tasks WHERE manager_id=$1 AND status IN ('open','in_progress')",[manager])
  ]);
  res.json({stores:sellerIds.length,products:products.rows[0].n,orders:orders.rows[0].n,open_tasks:tasks.rows[0].n});
}));

sellersRouter.get('/manager/customers', requireAuth, requireRole('seller_manager','admin'), asyncHandler(async(req,res)=>{
  const manager=req.user.roles.includes('admin')&&req.query.manager_id?req.query.manager_id:req.user.id;
  const {rows}=await query(`SELECT DISTINCT u.id,u.email,p.name,p.phone,max(o.created_at) last_order_at,count(o.id)::int orders FROM seller_manager_assignments sma JOIN orders o ON o.seller_id=sma.seller_id JOIN users u ON u.id=o.buyer_id LEFT JOIN profiles p ON p.user_id=u.id WHERE sma.manager_id=$1 AND sma.status='active' AND COALESCE((sma.permissions->>'customers')::boolean,false)=true GROUP BY u.id,p.name,p.phone ORDER BY last_order_at DESC LIMIT 300`,[manager]);
  res.json(rows);
}));

sellersRouter.get('/manager/tasks', requireAuth, requireRole('seller_manager','admin'), asyncHandler(async(req,res)=>{const manager=req.user.roles.includes('admin')&&req.query.manager_id?req.query.manager_id:req.user.id;const {rows}=await query('SELECT * FROM seller_manager_tasks WHERE manager_id=$1 ORDER BY created_at DESC',[manager]);res.json(rows);}));
sellersRouter.post('/manager/tasks', requireAuth, requireRole('seller','admin'), asyncHandler(async(req,res)=>{const seller=req.user.roles.includes('admin')&&req.body.seller_id?req.body.seller_id:req.user.id;const manager=req.body.manager_id;const assigned=await query("SELECT 1 FROM seller_manager_assignments WHERE seller_id=$1 AND manager_id=$2 AND status='active'",[seller,manager]);if(!assigned.rowCount)throw new HttpError(400,'Manager is not active on this store');const {rows}=await query('INSERT INTO seller_manager_tasks(seller_id,manager_id,title,description,priority,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[seller,manager,req.body.title,req.body.description||null,req.body.priority||'normal',req.body.due_at||null,req.user.id]);res.status(201).json(rows[0]);}));
sellersRouter.patch('/manager/tasks/:id', requireAuth, requireRole('seller_manager','seller','admin'), asyncHandler(async(req,res)=>{const {rows:[task]}=await query('SELECT * FROM seller_manager_tasks WHERE id=$1',[req.params.id]);if(!task)throw new HttpError(404,'Task not found');const allowed=req.user.roles.includes('admin')||task.manager_id===req.user.id||task.seller_id===req.user.id;if(!allowed)throw new HttpError(403,'Not permitted');const status=req.body.status||task.status;if(!['open','in_progress','done','cancelled'].includes(status))throw new HttpError(400,'Invalid status');const {rows}=await query('UPDATE seller_manager_tasks SET status=$1 WHERE id=$2 RETURNING *',[status,req.params.id]);res.json(rows[0]);}));
