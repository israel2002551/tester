import { useEffect, useLayoutEffect } from 'react';
import { marketplaceHtml } from '../legacy/marketplaceHtml.js';
import { prepareMarketplaceDom } from '../legacy/marketplaceDomFixes.js';
import { ensureRuntimeConfig, loadClassicScript } from '../lib/browserConfig.js';
import { authReady, getSession, isProtectedMarketplaceRoute, requireAuth } from '../lib/auth.js';

let runtimePromise;

function revealMarketplaceRoute(root) {
  const params = new URLSearchParams(window.location.search);

  // The legacy runtime normally reveals this surface from its auth-state
  // listener.  That listener is asynchronous, however, and a public desktop
  // visit such as `/?view=shop` must never depend on it to paint the page.
  // Reveal the destination explicitly once app.js is available.
  if (params.get('dashboard') === 'seller') {
    window.showSellerDashboard?.();
    return;
  }

  if (typeof window.showBuyerView === 'function') {
    window.showBuyerView();
  } else {
    // Keep a visible, usable marketplace even if a stale cached app.js has
    // not finished defining the legacy view helper yet.
    const buyerView = root?.querySelector('#buyer-view');
    const mainNav = root?.querySelector('#main-nav');
    const landing = root?.querySelector('#landing');
    buyerView?.classList.remove('hidden', 'page-enter');
    buyerView?.style.removeProperty('display');
    mainNav?.classList.remove('hidden');
    mainNav?.style.removeProperty('display');
    landing?.classList.add('hidden');
    landing?.style.setProperty('display', 'none', 'important');
  }

  if (params.get('view') === 'shop') {
    if (typeof window.switchBuyerTab === 'function') {
      window.switchBuyerTab('shop');
    } else {
      root?.querySelector('#buyer-shop-tab')?.classList.remove('hidden');
    }
  }
}

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
    const appScriptUrl = import.meta.env.DEV ? `/app.js?t=${Date.now()}` : '/app.js?v=10.36';
    runtimePromise = authReady
      .then(() => ensureRuntimeConfig())
      .then(() => loadClassicScript(appScriptUrl))
      .then(async () => {
        // app.js receives the already-initialised central client. Waiting for
        // its profile hydration prevents seller/dashboard flash on reload.
        await window.ensureCurrentUser?.();
      })
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
  useLayoutEffect(() => {
    prepareMarketplaceDom(document);
  }, []);

  useEffect(() => {
    let cancelled = false;
    document.body.classList.remove('product-page');
    document.title = 'BUYSELL Nigeria | Buy, Sell, and Manage Orders';
    const start = async () => {
      const protectedRoute = isProtectedMarketplaceRoute();
      if (protectedRoute) {
        document.body.classList.add('auth-pending');
        // BUYSELL uses an in-page login route instead of a standalone
        // login.html. requireAuth still performs a replace, so Back cannot
        // return visitors to a route they were not allowed to open.
        const params = new URLSearchParams(window.location.search);
        const loginRoute = params.get('dashboard') === 'seller'
          ? '/?entry=seller&mode=login'
          : '/?entry=buyer&mode=login';
        const user = await requireAuth(loginRoute);
        if (!user || cancelled) return;
      } else {
        await getSession();
        if (cancelled) return;
      }
      await loadMarketplaceRuntime();
      if (cancelled) return;
      revealMarketplaceRoute(document);
      window.syncAuthenticationNavigation?.();
      document.body.classList.remove('auth-pending');
    };
    start().catch(error => {
      console.warn('Marketplace authentication bootstrap failed:', error);
      if (!cancelled) document.body.classList.remove('auth-pending');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const renderedMarketplaceHtml = marketplaceHtml.replace(/Flash\s+Flash\s+Sale/g, 'Flash Sale');
  return <div dangerouslySetInnerHTML={{ __html: renderedMarketplaceHtml }} />;
}
