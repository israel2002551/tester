import { useEffect } from 'react';
import { marketplaceHtml } from '../legacy/marketplaceHtml.js';
import { loadClassicScript } from '../lib/browserConfig.js';

let runtimePromise;

export function loadMarketplaceRuntime() {
  if (!runtimePromise) {
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
    runtimePromise = loadClassicScript('/config.js?v=3.4').then(() => loadClassicScript('/app.js?v=10.20'));
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
