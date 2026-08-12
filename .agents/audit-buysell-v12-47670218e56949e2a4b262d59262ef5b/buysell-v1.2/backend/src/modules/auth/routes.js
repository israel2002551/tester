import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, tx } from '../../db/pool.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } from '../../utils/tokens.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter = Router();
const signupSchema = z.object({ email:z.email(), password:z.string().min(8), name:z.string().min(2).max(120), role:z.enum(['buyer','seller','supplier','seller_manager','rider']).default('buyer') });
const loginSchema = z.object({ email:z.email(), password:z.string().min(1) });

async function userWithRoles(id, client=query) {
  const exec = typeof client === 'function' ? client : client.query.bind(client);
  const { rows } = await exec(`SELECT u.id,u.email,u.status,u.password_reset_required,p.name,p.store_name,
    COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), ARRAY['buyer']::text[]) roles
    FROM users u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN user_roles ur ON ur.user_id=u.id
    WHERE u.id=$1 GROUP BY u.id,p.name,p.store_name`, [id]);
  return rows[0];
}
async function createSession(user, req, client) {
  const sid = randomUUID();
  const refreshToken = signRefreshToken(sid, user.id);
  const expires = new Date(Date.now()+env.refreshTokenDays*86400000);
  await client.query('INSERT INTO refresh_sessions(id,user_id,token_hash,user_agent,ip_address,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [sid,user.id,hashToken(refreshToken),req.get('user-agent')||null,req.ip||null,expires]);
  return { accessToken:signAccessToken(user), refreshToken, user };
}

authRouter.post('/signup', asyncHandler(async (req,res) => {
  const input=signupSchema.parse(req.body);
  const result=await tx(async client => {
    const exists=await client.query('SELECT 1 FROM users WHERE email=$1',[input.email]);
    if(exists.rowCount) throw new HttpError(409,'Email already exists');
    const {rows:[created]}=await client.query("INSERT INTO users(email,password_hash) VALUES($1,crypt($2,gen_salt('bf',12))) RETURNING id,email,status",[input.email,input.password]);
    await client.query('INSERT INTO profiles(user_id,name,role_legacy,accounts) VALUES($1,$2,$3,$3)',[created.id,input.name,input.role]);
    await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'buyer') ON CONFLICT DO NOTHING",[created.id]);
    if(input.role!=='buyer') await client.query('INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING',[created.id,input.role]);
    const user=await userWithRoles(created.id,client);
    return createSession(user,req,client);
  });
  res.status(201).json(result);
}));

authRouter.post('/login', asyncHandler(async (req,res) => {
  const input=loginSchema.parse(req.body);
  const result=await tx(async client => {
    const {rows}=await client.query("SELECT id,email,password_hash,status,(password_hash IS NOT NULL AND crypt($2,password_hash)=password_hash) AS password_ok FROM users WHERE email=$1",[input.email,input.password]);
    const base=rows[0];
    if(!base || !base.password_ok) throw new HttpError(401,'Invalid email or password');
    if(base.status!=='active') throw new HttpError(403,'Account is not active');
    await client.query('UPDATE users SET last_login_at=now(),last_seen_at=now(),login_count=login_count+1 WHERE id=$1',[base.id]);
    const user=await userWithRoles(base.id,client);
    return createSession(user,req,client);
  });
  res.json(result);
}));

authRouter.post('/refresh', asyncHandler(async (req,res) => {
  const token=req.body?.refreshToken;
  if(!token) throw new HttpError(400,'refreshToken is required');
  const payload=verifyRefreshToken(token);
  const result=await tx(async client => {
    const {rows}=await client.query('SELECT * FROM refresh_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()',[payload.sid,payload.sub]);
    const session=rows[0];
    if(!session || session.token_hash!==hashToken(token)) throw new HttpError(401,'Refresh session is invalid');
    await client.query('UPDATE refresh_sessions SET revoked_at=now() WHERE id=$1',[session.id]);
    const user=await userWithRoles(payload.sub,client);
    return createSession(user,req,client);
  });
  res.json(result);
}));

authRouter.post('/logout', requireAuth, asyncHandler(async (req,res) => {
  const refreshToken=req.body?.refreshToken;
  if(refreshToken){ try{ const p=verifyRefreshToken(refreshToken); await query('UPDATE refresh_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2',[p.sid,req.user.id]); }catch{} }
  res.status(204).end();
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req,res) => res.json({ user:await userWithRoles(req.user.id) })));
