import { useState, useEffect } from 'react';
import MarketplacePage from './pages/MarketplacePage.jsx';
import CategoryPage from './pages/CategoryPage.jsx';
import ProductPage from './pages/ProductPage.jsx';
import LegalPage from './pages/LegalPage.jsx';
import MarketingPage from './pages/MarketingPage.jsx';

const categoryRoutes = {
  '/products': 'all',
  '/products/': 'all',
  '/products.html': 'all',
  '/category/trending': 'trending',
  '/category-trending.html': 'trending',
  '/category/phones': 'phones',
  '/category-phones.html': 'phones',
  '/category/fashion': 'fashion',
  '/category-fashion.html': 'fashion',
  '/category/home': 'home',
  '/category-home.html': 'home',
  '/category/electronics': 'electronics',
  '/category-electronics.html': 'electronics',
  '/category/beauty': 'beauty',
  '/category-beauty.html': 'beauty',
  '/category/sports': 'sports',
  '/category-sports.html': 'sports',
  '/category/dropship': 'dropship',
  '/category-dropship.html': 'dropship',
  '/upcoming': 'upcoming',
  '/upcoming.html': 'upcoming',
};

const marketplaceQueryKeys = [
  'view',
  'entry',
  'mode',
  'store',
  'product',
  'cart',
  'checkout',
  'page',
  'category',
  'seller',
  'order',
  'q',
  'sort',
];

export function routeFor(pathname, search = '') {
  const withoutIndex = pathname.replace(/\/index\.html$/, '') || '/';
  const path = withoutIndex.length > 1 ? withoutIndex.replace(/\/+$/, '') : withoutIndex;
  const params = new URLSearchParams(search);
  if (path === '/product' || path === '/product.html') return { type: 'product' };
  if (path === '/privacy' || path === '/privacy.html') return { type: 'legal', page: 'privacy' };
  if (path === '/terms' || path === '/terms.html') return { type: 'legal', page: 'terms' };
  if (path === '/marketing' || path === '/marketing.html') return { type: 'marketing' };
  if (categoryRoutes[path]) {
    // `/products?category=...` is the shareable route for seller-defined
    // categories. Known categories still retain their dedicated SEO routes.
    const requestedCategory = path.startsWith('/products')
      ? String(params.get('category') || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)
      : '';
    return { type: 'category', category: requestedCategory || categoryRoutes[path] };
  }
  if (path === '/') {
    if (params.get('landing') === '1' || params.get('marketing') === '1') {
      return { type: 'marketing' };
    }
    // OAuth callbacks arrive at the configured site URL with transient auth
    // parameters. They must load the marketplace runtime so Supabase can
    // exchange the code and restore the authenticated session.
    const authCallbackKeys = ['code', 'state', 'error', 'error_code', 'error_description'];
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
    const hasAuthCallback = authCallbackKeys.some(key => params.has(key))
      || ['access_token', 'refresh_token', 'provider_token'].some(key => hashParams.has(key));
    const hasMarketplaceIntent = hasAuthCallback || marketplaceQueryKeys.some(key => params.has(key));
    return hasMarketplaceIntent ? { type: 'marketplace' } : { type: 'marketing' };
  }
  return { type: 'marketplace' };
}

export default function App() {
  const [currentLocation, setCurrentLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const syncLocation = () => {
      setCurrentLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', syncLocation);
    window.addEventListener('bs:navigate', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('bs:navigate', syncLocation);
    };
  }, []);

  const route = routeFor(currentLocation.pathname, currentLocation.search);
  if (route.type === 'product') return <ProductPage />;
  if (route.type === 'category') return <CategoryPage category={route.category} />;
  if (route.type === 'legal') return <LegalPage page={route.page} />;
  if (route.type === 'marketing') return <MarketingPage />;
  return <MarketplacePage />;
}
