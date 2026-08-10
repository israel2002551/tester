export function readGlobalConst(name, fallback = '') {
  try {
    return (0, eval)(name) ?? fallback;
  } catch (_) {
    return fallback;
  }
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
  if (readGlobalConst('SB_URL')) return;
  await loadClassicScript('/config.js?v=3.4');
}

export async function createSupabaseClient() {
  await ensureRuntimeConfig();
  const url = readGlobalConst('SB_URL');
  const key = readGlobalConst('SB_KEY');
  if (!window.supabase || !url || !key) throw new Error('Supabase config unavailable');
  return window.supabase.createClient(url, key);
}
