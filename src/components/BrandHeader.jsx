import { useEffect, useState } from 'react';
import { readJson } from '../lib/storage.js';

function getCartCount() {
  return readJson('bs_cart', []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
}

export default function BrandHeader({ className = '', marketplaceHref = '/?view=shop', onOpenCart }) {
  const [count, setCount] = useState(getCartCount());

  useEffect(() => {
    const handleStorage = () => setCount(getCartCount());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = marketplaceHref;
    }
  };

  return (
    <header className={className}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <button className="btn btn-outline btn-sm" onClick={handleBack} type="button" title="Back">
          <i className="fa-solid fa-arrow-left" /> Back
        </button>
        <a className="category-brand" href={marketplaceHref}>
          BUY<span>SELL</span>
        </a>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
        >
          <i className="fa-solid fa-cart-shopping" /><span>{count}</span>
        </button>
      </div>
    </header>
  );
}
