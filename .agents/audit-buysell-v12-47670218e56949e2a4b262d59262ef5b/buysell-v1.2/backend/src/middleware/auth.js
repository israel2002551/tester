import { verifyAccessToken } from '../utils/tokens.js';
import { query } from '../db/pool.js';
import { HttpError } from '../utils/http.js';

export async function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.auth = payload;
    req.user = { id: payload.sub, email: payload.email, roles: payload.roles || ['buyer'] };
  } catch {}
  next();
}

export async function requireAuth(req, _res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = verifyAccessToken(token);
    const { rows } = await query(`SELECT u.id,u.email,u.status,COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), ARRAY['buyer']::text[]) roles
      FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.id=$1 GROUP BY u.id`, [payload.sub]);
    const user = rows[0];
    if (!user || user.status !== 'active') throw new HttpError(401, 'Account is unavailable');
    req.auth = payload;
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Invalid or expired token'));
  }
}

export const requireRole = (...roles) => (req, _res, next) => {
  const userRoles = req.user?.roles || [];
  if (!roles.some((role) => userRoles.includes(role))) return next(new HttpError(403, 'Insufficient permission'));
  next();
};
