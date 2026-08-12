import { Router } from 'express';
import { query } from '../../db/pool.js';
import { asyncHandler,HttpError } from '../../utils/http.js';
import { requireAuth } from '../../middleware/auth.js';
export const profilesRouter=Router();
profilesRouter.get('/me',requireAuth,asyncHandler(async(req,res)=>{const {rows}=await query('SELECT p.*,u.email,u.status,u.created_at,u.last_login_at,u.last_seen_at,u.login_count FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1',[req.user.id]);res.json(rows[0]||{});}));
profilesRouter.patch('/me',requireAuth,asyncHandler(async(req,res)=>{const allowed=['name','phone','whatsapp','avatar_url','bio','store_name','store_description','store_address','logo_url','bank_name','account_number','account_name'];const entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length) return res.json({});const vals=entries.map(([,v])=>v);vals.push(req.user.id);const {rows}=await query(`UPDATE profiles SET ${entries.map(([k],i)=>`${k}=$${i+1}`).join(',')} WHERE user_id=$${vals.length} RETURNING *`,vals);res.json(rows[0]);}));
profilesRouter.delete('/me',requireAuth,asyncHandler(async(req,res)=>{await query("UPDATE users SET status='deleted',email=concat('deleted+',id,'@invalid.local'),password_hash=NULL WHERE id=$1",[req.user.id]);await query('UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1',[req.user.id]);res.status(204).end();}));
profilesRouter.get('/:id',asyncHandler(async(req,res)=>{const {rows}=await query('SELECT user_id,name,avatar_url,bio,store_name,store_description,store_address,logo_url,seller_verified,kyc_status FROM profiles WHERE user_id=$1',[req.params.id]);if(!rows[0])throw new HttpError(404,'Profile not found');res.json(rows[0]);}));

profilesRouter.get('/me/addresses', requireAuth, asyncHandler(async(req,res)=>{
  const {rows}=await query('SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC',[req.user.id]);
  res.json(rows);
}));
profilesRouter.post('/me/addresses', requireAuth, asyncHandler(async(req,res)=>{
  const {label=null,recipient_name,phone=null,line1,line2=null,city=null,state=null,country='Nigeria',latitude=null,longitude=null,is_default=false}=req.body;
  if(!recipient_name||!line1) throw new HttpError(400,'recipient_name and line1 are required');
  if(is_default) await query('UPDATE addresses SET is_default=false WHERE user_id=$1',[req.user.id]);
  const {rows}=await query(`INSERT INTO addresses(user_id,label,recipient_name,phone,line1,line2,city,state,country,latitude,longitude,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.id,label,recipient_name,phone,line1,line2,city,state,country,latitude,longitude,is_default]);
  res.status(201).json(rows[0]);
}));
profilesRouter.patch('/me/addresses/:id', requireAuth, asyncHandler(async(req,res)=>{
  const allowed=['label','recipient_name','phone','line1','line2','city','state','country','latitude','longitude','is_default'];
  const entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));
  if(!entries.length) throw new HttpError(400,'No valid fields');
  if(req.body.is_default) await query('UPDATE addresses SET is_default=false WHERE user_id=$1',[req.user.id]);
  const vals=entries.map(([,v])=>v); vals.push(req.params.id,req.user.id);
  const {rows}=await query(`UPDATE addresses SET ${entries.map(([k],i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${vals.length-1} AND user_id=$${vals.length} RETURNING *`,vals);
  if(!rows[0]) throw new HttpError(404,'Address not found');
  res.json(rows[0]);
}));
profilesRouter.delete('/me/addresses/:id', requireAuth, asyncHandler(async(req,res)=>{
  await query('DELETE FROM addresses WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  res.status(204).end();
}));
