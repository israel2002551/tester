import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler,HttpError } from '../../utils/http.js';
import { env } from '../../config/env.js';

export const paymentsRouter=Router();

async function flutterwave(path, options={}){
  if(!env.flutterwaveSecretKey) throw new HttpError(503,'Flutterwave secret key is not configured');
  const r=await fetch(`https://api.flutterwave.com/v3${path}`,{...options,headers:{Authorization:`Bearer ${env.flutterwaveSecretKey}`,'Content-Type':'application/json',...(options.headers||{})}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data.status!=='success') throw new HttpError(502,data.message||'Flutterwave request failed');
  return data.data;
}
async function verifyFlutterwave(transactionId){return flutterwave(`/transactions/${encodeURIComponent(transactionId)}/verify`);}

paymentsRouter.post('/flutterwave/initialize',requireAuth,asyncHandler(async(req,res)=>{
  const orderIds=[...new Set((req.body.order_ids||[]).map(String))];
  if(!orderIds.length) throw new HttpError(400,'order_ids is required');
  const {rows:orders}=await query(`SELECT id,total_amount,payment_status FROM orders WHERE id=ANY($1::uuid[]) AND buyer_id=$2`,[orderIds,req.user.id]);
  if(orders.length!==orderIds.length) throw new HttpError(404,'One or more orders were not found');
  if(orders.some(o=>o.payment_status==='successful')) throw new HttpError(409,'One or more orders are already paid');
  const amountKobo=orders.reduce((sum,o)=>sum+Number(o.total_amount||0),0);
  const profile=(await query('SELECT name,phone FROM profiles WHERE user_id=$1',[req.user.id])).rows[0]||{};
  const ref=`BS-PAY-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  await query(`INSERT INTO payment_transactions(user_id,order_id,provider,reference,amount,currency,status,metadata) VALUES($1,$2,'flutterwave',$3,$4,'NGN','pending',$5)`,[req.user.id,orders[0].id,ref,amountKobo,JSON.stringify({order_ids:orderIds})]);
  const redirect=`${env.publicMarketplaceUrl.replace(/\/$/,'')}/payments/flutterwave/callback`;
  const data=await flutterwave('/payments',{method:'POST',body:JSON.stringify({tx_ref:ref,amount:(amountKobo/100).toFixed(2),currency:'NGN',redirect_url:redirect,customer:{email:req.user.email,name:profile.name||'BUYSELL customer',phonenumber:profile.phone||undefined},customizations:{title:'BUYSELL Nigeria',description:`Payment for ${orders.length} order${orders.length>1?'s':''}`},meta:{user_id:req.user.id,order_ids:orderIds.join(',')}})});
  res.json({reference:ref,checkout_url:data.link,amount:amountKobo,currency:'NGN'});
}));

paymentsRouter.post('/flutterwave/verify',requireAuth,asyncHandler(async(req,res)=>{
  const data=await verifyFlutterwave(req.body.transaction_id);
  const {rows:[pending]}=await query(`SELECT * FROM payment_transactions WHERE reference=$1 AND user_id=$2 AND provider='flutterwave'`,[data.tx_ref,req.user.id]);
  if(!pending) throw new HttpError(404,'Payment reference not found');
  if(data.currency!=='NGN'||Math.round(Number(data.amount)*100)<Number(pending.amount)) throw new HttpError(409,'Payment amount or currency does not match');
  const orderIds=pending.metadata?.order_ids||[pending.order_id].filter(Boolean);
  await query(`UPDATE payment_transactions SET provider_transaction_id=$1,status='successful',raw_response=$2,verified_at=now() WHERE id=$3`,[String(data.id),JSON.stringify(data),pending.id]);
  if(orderIds.length) await query(`UPDATE orders SET payment_status='successful',payment_ref=$1 WHERE id=ANY($2::uuid[]) AND buyer_id=$3`,[data.tx_ref,orderIds,req.user.id]);
  res.json({success:true,reference:data.tx_ref,order_ids:orderIds,transaction:{id:data.id,amount:data.amount,currency:data.currency,status:data.status}});
}));

paymentsRouter.post('/flutterwave/initialize-ad',requireAuth,asyncHandler(async(req,res)=>{
  const {rows:[ad]}=await query('SELECT * FROM advertisements WHERE id=$1 AND advertiser_id=$2',[req.body.ad_id,req.user.id]);
  if(!ad)throw new HttpError(404,'Advertisement not found');
  if(ad.payment_status==='paid')throw new HttpError(409,'Advertisement is already paid');
  const profile=(await query('SELECT name,phone FROM profiles WHERE user_id=$1',[req.user.id])).rows[0]||{};
  const ref=`BS-AD-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  await query(`INSERT INTO payment_transactions(user_id,provider,reference,amount,currency,status,metadata) VALUES($1,'flutterwave',$2,$3,'NGN','pending',$4)`,[req.user.id,ref,env.adPriceKobo,JSON.stringify({type:'advertisement',ad_id:ad.id})]);
  await query(`UPDATE advertisements SET payment_ref=$1,payment_status='pending_payment' WHERE id=$2`,[ref,ad.id]);
  const redirect=`${env.publicMarketplaceUrl.replace(/\/$/,'')}/payments/flutterwave/callback?kind=ad&ad_id=${encodeURIComponent(ad.id)}`;
  const data=await flutterwave('/payments',{method:'POST',body:JSON.stringify({tx_ref:ref,amount:(env.adPriceKobo/100).toFixed(2),currency:'NGN',redirect_url:redirect,customer:{email:req.user.email,name:profile.name||'BUYSELL advertiser',phonenumber:profile.phone||undefined},customizations:{title:'BUYSELL Nigeria Advertisement',description:'30-day marketplace advertisement'},meta:{user_id:req.user.id,ad_id:ad.id,type:'advertisement'}})});
  res.json({reference:ref,checkout_url:data.link,amount:env.adPriceKobo,currency:'NGN',ad_id:ad.id});
}));

paymentsRouter.post('/flutterwave/verify-ad',requireAuth,asyncHandler(async(req,res)=>{
  const data=await verifyFlutterwave(req.body.transaction_id);
  const {rows:[pending]}=await query(`SELECT * FROM payment_transactions WHERE reference=$1 AND user_id=$2 AND provider='flutterwave'`,[data.tx_ref,req.user.id]);
  if(!pending||pending.metadata?.type!=='advertisement')throw new HttpError(404,'Advertisement payment reference not found');
  if(data.currency!=='NGN'||Math.round(Number(data.amount)*100)<Number(pending.amount))throw new HttpError(409,'Advertisement payment amount or currency does not match');
  const adId=pending.metadata.ad_id;
  await query(`UPDATE payment_transactions SET provider_transaction_id=$1,status='successful',raw_response=$2,verified_at=now() WHERE id=$3`,[String(data.id),JSON.stringify(data),pending.id]);
  const {rows:[ad]}=await query(`UPDATE advertisements SET amount_paid=$1,payment_ref=$2,payment_status='paid',status='pending' WHERE id=$3 AND advertiser_id=$4 RETURNING *`,[pending.amount,data.tx_ref,adId,req.user.id]);
  res.json({success:true,reference:data.tx_ref,ad,transaction:{id:data.id,amount:data.amount,currency:data.currency,status:data.status}});
}));
paymentsRouter.post('/flutterwave/webhook',asyncHandler(async(req,res)=>{const sig=req.headers['verif-hash'];if(env.flutterwaveWebhookSecret&&sig!==env.flutterwaveWebhookSecret)throw new HttpError(401,'Invalid webhook signature');const event=req.body;if(event?.data?.tx_ref){await query('UPDATE payment_transactions SET raw_response=$1 WHERE reference=$2',[JSON.stringify(event),event.data.tx_ref]);}res.json({received:true});}));
