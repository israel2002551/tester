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
];

export function routeFor(pathname, search = '') {
  const path = pathname.replace(/\/index\.html$/, '') || '/';
  if (path === '/product' || path === '/product.html') return { type: 'product' };
  if (path === '/privacy' || path === '/privacy.html') return { type: 'legal', page: 'privacy' };
  if (path === '/terms' || path === '/terms.html') return { type: 'legal', page: 'terms' };
  if (path === '/marketing' || path === '/marketing.html') return { type: 'marketing' };
  if (categoryRoutes[path]) return { type: 'category', category: categoryRoutes[path] };
  if (path === '/') {
    const params = new URLSearchParams(search);
    if (params.get('landing') === '1' || params.get('marketing') === '1') {
      return { type: 'marketing' };
    }
    const hasMarketplaceIntent = marketplaceQueryKeys.some(key => params.has(key));
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
    const onPopState = () => {
      setCurrentLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const route = routeFor(currentLocation.pathname, currentLocation.search);
  if (route.type === 'product') return <ProductPage />;
  if (route.type === 'category') return <CategoryPage category={route.category} />;
  if (route.type === 'legal') return <LegalPage page={route.page} />;
  if (route.type === 'marketing') return <MarketingPage />;
  return <MarketplacePage />;
}
