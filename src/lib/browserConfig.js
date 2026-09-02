export function readGlobalConst(name, fallback = '') {
  return window.BUYSELL_CONFIG?.[name] ?? window[name] ?? fallback;
}

export function runtimeConfig() {
  const env = import.meta.env || {};
  return {
    SB_URL: env.VITE_SUPABASE_URL || readGlobalConst('SB_URL'),
    SB_KEY: env.VITE_SUPABASE_ANON_KEY || readGlobalConst('SB_KEY'),
    FLUTTERWAVE_PUBLIC_KEY: env.VITE_FLUTTERWAVE_PUBLIC_KEY || readGlobalConst('FLUTTERWAVE_PUBLIC_KEY'),
    ADMIN_EMAIL: env.VITE_ADMIN_EMAIL || readGlobalConst('ADMIN_EMAIL'),
    ADMIN_EMAILS: (env.VITE_ADMIN_EMAILS || readGlobalConst('ADMIN_EMAILS', '') || '').toString(),
  };
}

function envRuntimeConfig() {
  const env = import.meta.env || {};
  return {
    SB_URL: env.VITE_SUPABASE_URL || '',
    SB_KEY: env.VITE_SUPABASE_ANON_KEY || '',
    FLUTTERWAVE_PUBLIC_KEY: env.VITE_FLUTTERWAVE_PUBLIC_KEY || '',
    ADMIN_EMAIL: env.VITE_ADMIN_EMAIL || '',
    ADMIN_EMAILS: env.VITE_ADMIN_EMAILS || '',
  };
}

export function installRuntimeGlobals() {
  const config = runtimeConfig();
  const adminEmails = Array.isArray(config.ADMIN_EMAILS)
    ? config.ADMIN_EMAILS
    : String(config.ADMIN_EMAILS || config.ADMIN_EMAIL || '').split(',').map(email => email.trim()).filter(Boolean);
  window.BUYSELL_CONFIG = { ...(window.BUYSELL_CONFIG || {}), ...config };
  window.SB_URL = config.SB_URL || window.SB_URL || '';
  window.SB_KEY = config.SB_KEY || window.SB_KEY || '';
  window.FLUTTERWAVE_PUBLIC_KEY = config.FLUTTERWAVE_PUBLIC_KEY || window.FLUTTERWAVE_PUBLIC_KEY || '';
  window.ADMIN_EMAIL = config.ADMIN_EMAIL || window.ADMIN_EMAIL || '';
  window.ADMIN_EMAILS = adminEmails.length ? adminEmails : window.ADMIN_EMAILS || [];
  window.EDGE_URL = window.SB_URL ? `${window.SB_URL}/functions/v1` : window.EDGE_URL || '';
  window.CLAUDE_EDGE_URL = window.EDGE_URL ? `${window.EDGE_URL}/smooth-handler` : window.CLAUDE_EDGE_URL || '';
  if (!window.supabaseClient && window.supabase && typeof window.supabase.createClient === 'function' && window.SB_URL && window.SB_KEY) {
    try {
      window.supabaseClient = window.supabase.createClient(window.SB_URL, window.SB_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      window.db = window.supabaseClient;
    } catch (e) {
      console.warn('installRuntimeGlobals client init warning:', e);
    }
  }
  return config;
}

export function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-react-loader="${src}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve(existing);
      return;
    }
    const script = existing || document.createElement('script');
    script.src = src;
    script.dataset.reactLoader = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(script);
    };
    script.onerror = reject;
    if (!existing) document.body.appendChild(script);
  });
}

export async function ensureRuntimeConfig() {
  const envConfig = envRuntimeConfig();
  if (!readGlobalConst('SB_URL') || !readGlobalConst('SB_KEY')) {
    await loadClassicScript('/config.js?v=3.5').catch(() => {});
  }
  if (envConfig.SB_URL || envConfig.SB_KEY) window.BUYSELL_CONFIG = { ...(window.BUYSELL_CONFIG || {}), ...envConfig };
  installRuntimeGlobals();
}

export async function createSupabaseClient() {
  await ensureRuntimeConfig();
  const config = runtimeConfig();
  const url = config.SB_URL || readGlobalConst('SB_URL');
  const key = config.SB_KEY || readGlobalConst('SB_KEY');
  if (!window.supabase || !url || !key) throw new Error('Supabase config unavailable');
  if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    window.db = window.supabaseClient;
  }
  return window.supabaseClient;
}

