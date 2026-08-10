import { useEffect } from 'react';
import { marketingHtml } from '../legacy/marketingHtml.js';
import { loadMarketplaceRuntime } from './MarketplacePage.jsx';

export default function MarketingPage() {
  useEffect(() => {
    document.body.className = '';
    document.title = 'BUYSELL Nigeria | Marketplace tools for Nigerian commerce';
    loadMarketplaceRuntime();

    const routeMarketingAction = event => {
      const button = event.target.closest('button[onclick]');
      const action = button?.getAttribute('onclick') || '';
      if (!button || (!action.includes('enterSite') && !action.includes('auth-modal'))) return;
      event.preventDefault();
      event.stopPropagation();
      const sellerIntent = action.includes('seller');
      const target = sellerIntent ? '/?entry=seller&mode=signup' : '/?view=shop';
      window.location.href = target;
    };

    document.addEventListener('click', routeMarketingAction, true);
    return () => document.removeEventListener('click', routeMarketingAction, true);
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: marketingHtml }} />;
}
