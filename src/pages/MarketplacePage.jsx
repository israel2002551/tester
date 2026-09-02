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
    runtimePromise = ensureRuntimeConfig().then(() => loadClassicScript('/app.js?v=10.22'));
  } else {
    // If runtime was already loaded and MarketplacePage is remounted, restore the active marketplace view
    setTimeout(() => {
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
    document.body.className = '';
    document.title = 'BUYSELL Nigeria | Buy, Sell, and Manage Orders';
    loadMarketplaceRuntime();
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: marketplaceHtml }} />;
}
