import { Router } from 'express';
import { query, tx } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const messagesRouter = Router();

messagesRouter.get('/', requireAuth, asyncHandler(async(req,res) => {
  const {rows}=await query(`
    SELECT c.id,c.order_id,c.updated_at,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'user_id', cm.user_id,
        'name', p.name,
        'store_name', p.store_name,
        'avatar_url', p.avatar_url
      )) FILTER (WHERE cm.user_id <> $1), '[]'::jsonb) AS participants,
      (SELECT row_to_json(m) FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) last_message,
      (SELECT count(*)::int FROM messages um WHERE um.conversation_id=c.id AND um.receiver_id=$1 AND um.is_read=false) unread_count
    FROM conversations c
    JOIN conversation_members own ON own.conversation_id=c.id AND own.user_id=$1
    JOIN conversation_members cm ON cm.conversation_id=c.id
    LEFT JOIN profiles p ON p.user_id=cm.user_id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `,[req.user.id]);
  res.json(rows);
}));

messagesRouter.post('/conversations', requireAuth, asyncHandler(async(req,res) => {
  const other=req.body.user_id;
  if(!other) throw new HttpError(400,'user_id required');
  if(other===req.user.id) throw new HttpError(400,'Cannot create a conversation with yourself');
  const target=await query("SELECT id FROM users WHERE id=$1 AND status='active'",[other]);
  if(!target.rowCount) throw new HttpError(404,'User not found');
  const convo=await tx(async c=>{
    const existing=await c.query(`
      SELECT c.id,c.order_id,c.updated_at FROM conversations c
      WHERE EXISTS(SELECT 1 FROM conversation_members x WHERE x.conversation_id=c.id AND x.user_id=$1)
        AND EXISTS(SELECT 1 FROM conversation_members y WHERE y.conversation_id=c.id AND y.user_id=$2)
        AND (($3::uuid IS NULL AND c.order_id IS NULL) OR c.order_id=$3::uuid)
      LIMIT 1
    `,[req.user.id,other,req.body.order_id||null]);
    if(existing.rows[0]) return existing.rows[0];
    const {rows:[created]}=await c.query('INSERT INTO conversations(order_id) VALUES($1) RETURNING *',[req.body.order_id||null]);
    await c.query('INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3)',[created.id,req.user.id,other]);
    return created;
  });
  res.status(201).json(convo);
}));

messagesRouter.get('/:conversationId', requireAuth, asyncHandler(async(req,res) => {
  const member=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[req.params.conversationId,req.user.id]);
  if(!member.rowCount) throw new HttpError(403,'Not a conversation member');
  const {rows}=await query(`
    SELECT m.*, p.name sender_name, p.avatar_url sender_avatar
    FROM messages m LEFT JOIN profiles p ON p.user_id=m.sender_id
    WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 300
  `,[req.params.conversationId]);
  await query('UPDATE messages SET is_read=true WHERE conversation_id=$1 AND receiver_id=$2',[req.params.conversationId,req.user.id]);
  res.json(rows);
}));

messagesRouter.post('/:conversationId', requireAuth, asyncHandler(async(req,res) => {
  const membership=await query('SELECT user_id FROM conversation_members WHERE conversation_id=$1',[req.params.conversationId]);
  if(!membership.rows.some(r=>r.user_id===req.user.id)) throw new HttpError(403,'Not a conversation member');
  const content=String(req.body.content||'').trim();
  if(!content) throw new HttpError(400,'Message cannot be empty');
  const receiver=membership.rows.find(r=>r.user_id!==req.user.id)?.user_id||null;
  const {rows}=await query('INSERT INTO messages(conversation_id,sender_id,receiver_id,content,message,body,order_id) VALUES($1,$2,$3,$4,$4,$4,$5) RETURNING *',[req.params.conversationId,req.user.id,receiver,content,req.body.order_id||null]);
  await query('UPDATE conversations SET updated_at=now() WHERE id=$1',[req.params.conversationId]);
  res.status(201).json(rows[0]);
}));
