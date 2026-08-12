import { env } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';
import { verifySupabaseAccessToken } from './supabase.js';

function bearer(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export async function resolveUser(db, claims) {
  const providerSubject = String(claims.sub);
  const include = {
    profile: true,
    platformRoles: true,
    storeMemberships: { where: { status: 'ACTIVE' }, include: { store: true, permissions: true } },
    supplierProfile: true,
  };
  let identity = await db.authIdentity.findUnique({
    where: { provider_providerSubject: { provider: 'SUPABASE', providerSubject } },
    include: { user: { include } },
  });
  if (!identity) {
    const verifiedEmail = claims.email && (claims.email_verified === true || Boolean(claims.email_confirmed_at));
    const existingUser = claims.email ? await db.user.findUnique({ where: { email: claims.email } }) : null;
    if (existingUser && !verifiedEmail) {
      throw unauthorized('Verify this email address with the identity provider before linking the migrated BUYSELL account.');
    }
    try {
      if (existingUser) {
        identity = await db.authIdentity.create({
          data: { userId: existingUser.id, provider: 'SUPABASE', providerSubject, providerEmail: claims.email },
          include: { user: { include } },
        });
      } else {
        identity = await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: claims.email || null,
              lastLoginAt: new Date(),
              profile: { create: { displayName: claims.email?.split('@')[0] || 'BUYSELL member' } },
              authIdentities: { create: { provider: 'SUPABASE', providerSubject, providerEmail: claims.email || null } },
            },
            include,
          });
          return { user };
        });
      }
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      identity = await db.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'SUPABASE', providerSubject } },
        include: { user: { include } },
      });
      if (!identity) throw unauthorized('This identity could not be linked safely. Contact support if the account was migrated.');
    }
  }
  if (!identity?.user || identity.user.status !== 'ACTIVE') {
    throw unauthorized('This BUYSELL account is not active.');
  }
  await db.user.update({ where: { id: identity.user.id }, data: { lastLoginAt: new Date() } });
  return identity.user;
}

async function devUser(db, req) {
  if (env.isProduction || !env.ALLOW_DEV_AUTH) return null;
  const requested = String(req.get('x-dev-user') || env.DEV_AUTH_SUBJECT);
  if (!/^[0-9a-f-]{36}$/i.test(requested)) throw unauthorized('The development user identifier is invalid.');
  const identity = await db.authIdentity.upsert({
    where: { provider_providerSubject: { provider: 'SUPABASE', providerSubject: requested } },
    update: {},
    create: {
      provider: 'SUPABASE',
      providerSubject: requested,
      providerEmail: `dev-${requested.slice(0, 8)}@local.invalid`,
      user: {
        create: {
          email: `dev-${requested.slice(0, 8)}@local.invalid`,
          profile: { create: { displayName: 'Local developer' } },
        },
      },
    },
    include: {
      user: {
        include: {
          profile: true,
          platformRoles: true,
          storeMemberships: { where: { status: 'ACTIVE' }, include: { store: true, permissions: true } },
          supplierProfile: true,
        },
      },
    },
  });
  return identity.user;
}

export function attachDatabase(db) {
  return (req, _res, next) => {
    req.db = db;
    next();
  };
}

export function optionalAuth() {
  return async (req, _res, next) => {
    try {
      const token = bearer(req);
      if (!token) {
        req.user = await devUser(req.db, req);
        return next();
      }
      req.authClaims = await verifySupabaseAccessToken(token);
      req.user = await resolveUser(req.db, req.authClaims);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireAuth() {
  return [optionalAuth(), (req, _res, next) => req.user ? next() : next(unauthorized())];
}

export function userSummary(user) {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    profile: user.profile,
    platformRoles: user.platformRoles?.map((assignment) => assignment.role) || [],
    storeMemberships: user.storeMemberships || [],
    supplierProfile: user.supplierProfile || null,
  };
}
