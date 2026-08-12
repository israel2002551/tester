import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const ordersRouter = Router();

async function managerSellerIds(userId, permission='orders') {
  const {rows}=await query(`SELECT seller_id,permissions FROM seller_manager_assignments WHERE manager_id=$1 AND status='active'`,[userId]);
  return rows.filter(r=>r.permissions?.[permission]).map(r=>r.seller_id);
}
async function canAccessOrder(user, order, permission='orders') {
  if(user.roles.includes('admin') || order.buyer_id===user.id || order.seller_id===user.id) return true;
  if(user.roles.includes('seller_manager')) return (await managerSellerIds(user.id,permission)).includes(order.seller_id);
  if(user.roles.includes('rider')) {
    const d=await query('SELECT 1 FROM deliveries WHERE order_id=$1 AND rider_id=$2',[order.id,user.id]);
    return Boolean(d.rowCount);
  }
  return false;
}

ordersRouter.get('/', requireAuth, asyncHandler(async(req,res) => {
  if(req.user.roles.includes('admin') && req.query.as==='admin') {
    const {rows}=await query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500');
    return res.json(rows);
  }
  if(req.user.roles.includes('seller_manager') && req.query.as==='seller') {
    const sellerIds=await managerSellerIds(req.user.id,'orders');
    if(!sellerIds.length) return res.json([]);
    const {rows}=await query('SELECT * FROM orders WHERE seller_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 200',[sellerIds]);
    return res.json(rows);
  }
  if(req.user.roles.includes('rider') && req.query.as==='rider') {
    const {rows}=await query('SELECT o.* FROM orders o JOIN deliveries d ON d.order_id=o.id WHERE d.rider_id=$1 ORDER BY o.created_at DESC LIMIT 200',[req.user.id]);
    return res.json(rows);
  }
  const isSeller=req.query.as==='seller'||(req.user.roles.includes('seller')&&req.query.as!=='buyer');
  const col=isSeller?'seller_id':'buyer_id';
  const {rows}=await query(`SELECT * FROM orders WHERE ${col}=$1 ORDER BY created_at DESC LIMIT 100`,[req.user.id]);
  res.json(rows);
}));

ordersRouter.get('/:id', requireAuth, asyncHandler(async(req,res) => {
  const {rows}=await query('SELECT * FROM orders WHERE id=$1',[req.params.id]);
  const order=rows[0];
  if(!order || !(await canAccessOrder(req.user,order))) throw new HttpError(404,'Order not found');
  const items=await query('SELECT * FROM order_items WHERE order_id=$1',[req.params.id]);
  const events=await query('SELECT * FROM order_status_events WHERE order_id=$1 ORDER BY created_at',[req.params.id]);
  const delivery=await query('SELECT * FROM deliveries WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',[req.params.id]);
  res.json({...order,order_items:items.rows,status_events:events.rows,delivery:delivery.rows[0]||null});
}));

ordersRouter.post('/', requireAuth, asyncHandler(async(req,res) => {
  const input=z.object({
    items:z.array(z.object({product_id:z.uuid(),quantity:z.number().int().min(1)})).min(1),
    delivery_name:z.string().min(2),delivery_phone:z.string().optional(),delivery_address:z.string().min(4),
    payment_method:z.string().default('flutterwave'),payment_ref:z.string().optional(),
  }).parse(req.body);
  const result=await tx(async c=>{
    const ids=[...new Set(input.items.map(i=>i.product_id))];
    const {rows:products}=await c.query(`SELECT * FROM products WHERE id=ANY($1::uuid[]) AND status='active' FOR UPDATE`,[ids]);
    if(products.length!==ids.length) throw new HttpError(400,'One or more products are unavailable');
    const byId=new Map(products.map(p=>[p.id,p]));
    const groups=new Map();
    for(const item of input.items){
      const p=byId.get(item.product_id);
      if(p.stock_quantity<item.quantity) throw new HttpError(409,`${p.name} is out of stock`);
      if(!groups.has(p.seller_id)) groups.set(p.seller_id,[]);
      groups.get(p.seller_id).push({item,product:p});
    }
    const orders=[];
    for(const [sellerId,group] of groups){
      let subtotal=0,shipping=0;
      for(const {item,product:p} of group){subtotal+=Number(p.price)*item.quantity;shipping+=Number(p.shipping_fee||p.shipping_cost||0)*item.quantity;}
      const platform=Math.round(subtotal*0.03),total=subtotal+shipping+platform;
      const legacyItems=group.map(({item,product:p})=>({id:p.id,product_id:p.id,name:p.name,price:p.price,quantity:item.quantity,image_url:p.image_url,seller_id:p.seller_id}));
      const {rows:[order]}=await c.query(`INSERT INTO orders(buyer_id,seller_id,total_amount,subtotal,shipping_amount,platform_fee,payment_method,payment_ref,delivery_name,delivery_phone,delivery_address,items) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.id,sellerId,total,subtotal,shipping,platform,input.payment_method,input.payment_ref||null,input.delivery_name,input.delivery_phone||null,input.delivery_address,JSON.stringify(legacyItems)]);
      for(const {item,product:p} of group){
        await c.query('INSERT INTO order_items(order_id,product_id,seller_id,name,image_url,unit_price,quantity,shipping_fee) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[order.id,p.id,p.seller_id,p.name,p.image_url,p.price,item.quantity,p.shipping_fee||0]);
        await c.query('UPDATE products SET stock_quantity=stock_quantity-$1 WHERE id=$2',[item.quantity,p.id]);
      }
      await c.query('INSERT INTO order_status_events(order_id,status,actor_id,note) VALUES($1,$2,$3,$4)',[order.id,'pending',req.user.id,'Order created']);
      orders.push(order);
    }
    return orders;
  });
  res.status(201).json({id:result[0]?.id,orders:result,total_orders:result.length});
}));

ordersRouter.post('/:id/payment-proof', requireAuth, asyncHandler(async(req,res) => {
  const proof=String(req.body.proof_url||'').trim();
  if(!proof) throw new HttpError(400,'proof_url is required');
  const {rows}=await query(`UPDATE orders SET proof_url=$1,payment_proof_url=$1,updated_at=now() WHERE id=$2 AND buyer_id=$3 AND payment_method='bank_transfer' RETURNING *`,[proof,req.params.id,req.user.id]);
  if(!rows[0]) throw new HttpError(404,'Bank-transfer order not found');
  res.json(rows[0]);
}));

ordersRouter.patch('/:id/status', requireAuth, requireRole('seller','seller_manager','rider','admin'), asyncHandler(async(req,res) => {
  const status=z.enum(['pending','confirmed','processing','shipped','delivered','cancelled','refunded','disputed']).parse(req.body.status);
  const {rows:[order]}=await query('SELECT * FROM orders WHERE id=$1',[req.params.id]);
  if(!order || !(await canAccessOrder(req.user,order,'orders'))) throw new HttpError(404,'Order not found or forbidden');
  const {rows}=await query('UPDATE orders SET status=$1,tracking_note=$2 WHERE id=$3 RETURNING *',[status,req.body.note||null,req.params.id]);
  await query('INSERT INTO order_status_events(order_id,status,actor_id,note) VALUES($1,$2,$3,$4)',[req.params.id,status,req.user.id,req.body.note||null]);
  res.json(rows[0]);
}));
