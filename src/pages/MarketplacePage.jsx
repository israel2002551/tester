import { useEffect } from 'react';
import { marketplaceHtml } from '../legacy/marketplaceHtml.js';
import { ensureRuntimeConfig, loadClassicScript } from '../lib/browserConfig.js';

let runtimePromise;

export function loadMarketplaceRuntime() {
  window.bsCanUseBrowserStorage = function bsCanUseBrowserStorage(storageName) {
    try {
      const storage = window[storageName || 'localStorage'];
      const testKey = '__bs_storage_test__';
      storage.setItem(testKey, '1');
      storage.removeItem(testKey);
      return true;
    } catch (_) {
      return false;
    }
  };

  if (!runtimePromise) {
    // Version the classic runtime explicitly so an application deploy also
    // refreshes service-worker and notification-route safeguards immediately.
    const appScriptUrl = import.meta.env.DEV ? `/app.js?t=${Date.now()}` : '/app.js?v=10.34';
    runtimePromise = ensureRuntimeConfig()
      .then(() => loadClassicScript(appScriptUrl))
      .then(() => window.applyPlatformBrandAssets?.());
  } else {
    // If runtime was already loaded and MarketplacePage is remounted, restore the active marketplace view
    setTimeout(() => {
      window.applyPlatformBrandAssets?.();
      if (typeof window.showBuyerView === 'function') {
        window.showBuyerView();
      }
      if (typeof window.loadProducts === 'function') {
        window.loadProducts({ preferCache: true });
      }
      if (typeof window.handleDeepLink === 'function') {
        window.handleDeepLink();
      }
    }, 50);
  }
  return runtimePromise;
}

export default function MarketplacePage() {
  useEffect(() => {
    document.body.classList.remove('product-page');
    document.title = 'BUYSELL Nigeria | Buy, Sell, and Manage Orders';
    window.syncAuthenticationNavigation?.();
    loadMarketplaceRuntime().then(() => window.syncAuthenticationNavigation?.());
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: marketplaceHtml }} />;
}
