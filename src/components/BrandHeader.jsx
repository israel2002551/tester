import { useEffect, useState } from 'react';
import { readJson } from '../lib/storage.js';
import BrandLogo from './BrandLogo.jsx';

function getCartCount() {
  return readJson('bs_cart', []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
}

export default function BrandHeader({ className = '', marketplaceHref = '/?view=shop', onOpenCart }) {
  const [count, setCount] = useState(getCartCount());

  useEffect(() => {
    const handleStorage = () => setCount(getCartCount());
    const handleCartChange = () => setCount(getCartCount());
    window.addEventListener('storage', handleStorage);
    window.addEventListener('bs:cart-change', handleCartChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('bs:cart-change', handleCartChange);
    };
  }, []);

  const handleBack = () => {
    let canReturnToMarketplace = false;
    try {
      const previousUrl = new URL(document.referrer);
      canReturnToMarketplace = previousUrl.origin === window.location.origin
        && !/[?&](entry|mode)=/.test(previousUrl.search);
    } catch (_) {
      canReturnToMarketplace = false;
    }
    if (window.history.length > 1 && canReturnToMarketplace) {
      window.history.back();
    } else {
      window.location.href = marketplaceHref;
    }
  };

  return (
    <header className={`commerce-page-header ${className}`.trim()}>
      <div className="commerce-page-header__brand">
        <button className="btn btn-outline btn-sm" onClick={handleBack} type="button" title="Back">
          <i className="fa-solid fa-arrow-left" /> Back
        </button>
        <a className="category-brand category-brand--asset" href={marketplaceHref}>
          <BrandLogo variant="transparent" />
        </a>
      </div>
      <nav className="commerce-page-header__links" aria-label="Storefront navigation">
        <a href={marketplaceHref}>Marketplace</a>
        <a href="/products">Categories</a>
        <a href="/category/dropship">1688 Sourcing</a>
      </nav>
      <div className="commerce-page-header__actions">
        <a className="btn btn-outline btn-sm" href={marketplaceHref}>
          <i className="fa-solid fa-store" /> Marketplace
        </a>
        <button
          className="product-cart-pill"
          onClick={() => {
            if (onOpenCart) onOpenCart();
            else window.location.href = '/?view=shop&cart=open';
          }}
          type="button"
          title="View Cart"
          aria-label={`Open cart, ${count} ${count === 1 ? 'item' : 'items'}`}
        >
          <i className="fa-solid fa-cart-shopping" /><span>{count}</span>
        </button>
      </div>
    </header>
  );
}
