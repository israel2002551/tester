import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, roles: user.roles || ['buyer'] }, env.jwtAccessSecret, { expiresIn: env.accessTokenTtl });
}
export function signRefreshToken(sessionId, userId) {
  return jwt.sign({ sub: userId, sid: sessionId, type: 'refresh' }, env.jwtRefreshSecret, { expiresIn: `${env.refreshTokenDays}d` });
}
export function verifyAccessToken(token) { return jwt.verify(token, env.jwtAccessSecret); }
export function verifyRefreshToken(token) { return jwt.verify(token, env.jwtRefreshSecret); }
export function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
