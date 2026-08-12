import { Router } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';
export const notificationsRouter=Router();
notificationsRouter.get('/',requireAuth,asyncHandler(async(req,res)=>{const {rows}=await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id]);res.json(rows);}));
notificationsRouter.post('/subscribe',requireAuth,asyncHandler(async(req,res)=>{const endpoint=req.body.endpoint||req.body.device_token;if(endpoint)await query('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,device_token,user_agent) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,device_token=EXCLUDED.device_token,last_seen_at=now()',[req.user.id,endpoint,req.body.keys?.p256dh||null,req.body.keys?.auth||null,req.body.device_token||null,req.get('user-agent')||null]);res.json({ok:true});}));
notificationsRouter.patch('/:id/read',requireAuth,asyncHandler(async(req,res)=>{await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.status(204).end();}));
notificationsRouter.post('/test',requireAuth,asyncHandler(async(req,res)=>{const {rows}=await query(`INSERT INTO notifications(user_id,title,body,type,url) VALUES($1,$2,$3,'test',$4) RETURNING *`,[req.user.id,req.body.title||'BUYSELL Nigeria',req.body.body||'Notifications are active.',req.body.url||'/']);res.json({sent:1,notification:rows[0]});}));
