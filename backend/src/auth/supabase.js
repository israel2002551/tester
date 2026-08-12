import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { unauthorized, unavailable } from '../lib/errors.js';

let remoteKeys;

function projectIssuer() {
  return `${env.SUPABASE_URL?.replace(/\/$/, '')}/auth/v1`;
}

function jwks() {
  if (!remoteKeys) {
    remoteKeys = createRemoteJWKSet(new URL(`${projectIssuer()}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  }
  return remoteKeys;
}

async function verifyThroughAuthServer(token) {
  if (!env.SUPABASE_PUBLISHABLE_KEY) {
    throw unavailable('AUTH_NOT_CONFIGURED', 'Supabase Auth verification is not configured.');
  }
  const response = await fetch(`${projectIssuer()}/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw unauthorized('The access token is invalid or expired.');
  const user = await response.json();
  return {
    sub: user.id,
    email: user.email || null,
    email_verified: Boolean(user.email_confirmed_at || user.confirmed_at),
    phone: user.phone || null,
    aud: 'authenticated',
    iss: projectIssuer(),
  };
}

export async function verifySupabaseAccessToken(token) {
  if (!env.SUPABASE_URL) {
    throw unavailable('AUTH_NOT_CONFIGURED', 'Supabase Auth verification is not configured.');
  }

  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw unauthorized('The access token is malformed.');
  }

  if (header.alg === 'HS256' || !header.kid) {
    return verifyThroughAuthServer(token);
  }

  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: projectIssuer(),
      audience: 'authenticated',
      algorithms: ['RS256', 'ES256'],
    });
    if (!payload.sub) throw unauthorized('The access token has no subject.');
    return payload;
  } catch (error) {
    if (error?.status === 401) throw error;
    throw unauthorized('The access token is invalid or expired.');
  }
}
