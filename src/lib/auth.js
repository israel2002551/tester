import { createSupabaseClient } from './browserConfig.js';

// This module is the only place that restores the browser session. Consumers
// must await getSession()/authReady instead of reading Supabase synchronously
// during page startup.
export let supabase = null;

export const authReady = (async () => {
  try {
    supabase = await createSupabaseClient();
    if (typeof window !== 'undefined') {
      window.BUYSELL_AUTH = {
        supabase,
        getSession,
        requireAuth,
        redirectIfAuthenticated,
        logoutUser,
        onAuthStateChange,
      };
    }
    return supabase;
  } catch (error) {
    console.warn('Authentication bootstrap could not create a Supabase client:', error);
    return null;
  }
})();

export async function getSession() {
  try {
    const client = supabase || await authReady;
    if (!client?.auth?.getSession) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  } catch (error) {
    console.warn('Could not restore the saved authentication session:', error);
    return null;
  }
}

function saveReturnPath() {
  try {
    // Keep this to the pathname as a safe, same-origin return target. Feature
    // routes in this SPA also retain their query state in a separate key.
    window.sessionStorage.setItem('redirect_after_login', window.location.pathname);
    window.sessionStorage.setItem(
      'redirect_after_login_route',
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
  } catch (_) {
    // Private browsing may block sessionStorage; the login route still works.
  }
}

export async function requireAuth(redirectTo = 'login.html') {
  const session = await getSession();
  if (session?.user) return session.user;
  saveReturnPath();
  window.location.replace(redirectTo);
  return null;
}

export async function redirectIfAuthenticated(redirectTo = 'index.html') {
  const session = await getSession();
  if (session?.user) {
    window.location.replace(redirectTo);
    return session.user;
  }
  return null;
}

export async function logoutUser(redirectTo = 'login.html') {
  try {
    const client = supabase || await authReady;
    await client?.auth?.signOut();
  } catch (error) {
    // Redirect even if a network error prevents Supabase from acknowledging the
    // sign-out; local auth storage is cleared by the client when possible.
    console.warn('Supabase sign-out did not complete cleanly:', error);
  }
  window.location.replace(redirectTo);
}

/** Subscribe after initialization so the legacy runtime never creates a second client. */
export async function onAuthStateChange(callback) {
  const client = supabase || await authReady;
  if (!client?.auth?.onAuthStateChange) return null;
  const { data } = client.auth.onAuthStateChange(callback);
  return data?.subscription || null;
}

/** Routes whose initial render contains account, order, or seller data. */
export function isProtectedMarketplaceRoute(location = window.location) {
  const params = new URLSearchParams(location.search);
  return params.get('dashboard') === 'seller'
    || params.get('page') === 'checkout'
    || params.get('checkout') === 'open'
    || params.get('page') === 'messages'
    || params.get('page') === 'chat'
    || params.has('chat');
}
