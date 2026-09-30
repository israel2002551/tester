function safeStorage() {
  try {
    localStorage.setItem('__bs_react_storage__', '1');
    localStorage.removeItem('__bs_react_storage__');
    return localStorage;
  } catch (_) {
    const memory = new Map();
    return {
      getItem: key => memory.get(key) || null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: key => memory.delete(key),
    };
  }
}

export const appStorage = safeStorage();

export function readJson(key, fallback) {
  try {
    return JSON.parse(appStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

export function writeJson(key, value) {
  appStorage.setItem(key, JSON.stringify(value));
}

// The product detail page is React while checkout is still provided by the
// retained classic runtime. This short-lived snapshot protects the full-page
// handoff when browser storage is not immediately available on navigation.
export const checkoutCartHandoffKey = 'bs_checkout_cart_handoff';

export function writeCheckoutCartHandoff(items) {
  try {
    sessionStorage.setItem(checkoutCartHandoffKey, JSON.stringify(Array.isArray(items) ? items : []));
  } catch (_) {
    // Durable localStorage remains the primary cart source.
  }
}
