import { useEffect } from 'react';
import { marketingHtml } from '../legacy/marketingHtml.js';

export default function MarketingPage() {
  useEffect(() => {
    document.body.className = '';
    document.title = 'BUYSELL Nigeria | Marketplace tools for Nigerian commerce';

    const revealItems = document.querySelectorAll('.bs-reveal');
    revealItems.forEach(item => item.classList.add('is-visible'));

    const routeMarketingAction = event => {
      const button = event.target.closest('button[onclick]');
      const action = button?.getAttribute('onclick') || '';
      if (!button || (!action.includes('enterSite') && !action.includes('auth-modal'))) return;
      event.preventDefault();
      event.stopPropagation();

      const label = button.textContent.toLowerCase();
      const signupIntent = action.includes('signup') || label.includes('free') || label.includes('start');
      const sellerIntent = action.includes('seller') || label.includes('seller') || label.includes('store');
      const target = signupIntent
        ? `/?entry=${sellerIntent ? 'seller' : 'buyer'}&mode=signup`
        : '/?view=shop';
      window.location.href = target;
    };

    const switchHowItWorksTab = event => {
      const tab = event.target.closest('.bs-how__tab[data-tab]');
      if (!tab) return;
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.bs-how__tab').forEach(item => {
        item.classList.toggle('bs-active', item === tab);
      });
      document.querySelectorAll('.bs-how__flow').forEach(flow => {
        flow.classList.toggle('bs-active', flow.dataset.flow === tabName);
      });
    };

    document.addEventListener('click', routeMarketingAction, true);
    document.addEventListener('click', switchHowItWorksTab);
    return () => {
      document.removeEventListener('click', routeMarketingAction, true);
      document.removeEventListener('click', switchHowItWorksTab);
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: marketingHtml }} />;
}
