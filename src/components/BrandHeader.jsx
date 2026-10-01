
import { useEffect, useState } from 'react';
import { readJson } from '../lib/storage.js';
import BrandLogo from './BrandLogo.jsx';

function getCartCount() {
  return readJson('bs_cart', []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
}

export default function BrandHeader({ className = '', marketplaceHref = '/?view=shop', onOpenCart }) {
  const [count, setCount] = useState(getCartCount());

  useEffect(() => {
    const sync = () => setCount(getCartCount());
    window.addEventListener('storage', sync);
    window.addEventListener('bs:cart-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('bs:cart-change', sync);
    };
  }, []);

  const openCart = () => {
    if (onOpenCart) onOpenCart();
    else window.location.href = '/?view=shop&cart=open';
  };

  return (
    <header className={'commerce-page-header ' + className}>
      <div className="commerce-page-header__brand">
        <a className="category-brand category-brand--asset" href={marketplaceHref} aria-label="BUYSELL marketplace">
          <BrandLogo variant="transparent" />
        </a>
      </div>

      <nav className="commerce-page-header__links" aria-label="Store navigation">
        <a href={marketplaceHref}>Shop</a>
        <a href="/products">Categories</a>
        <a href="/category/dropship">Bulk & sourcing</a>
      </nav>

      <div className="commerce-page-header__actions">
        <a className="btn btn-outline btn-sm" href="/?view=shop&q=" aria-label="Search products">
          <i className="fa-solid fa-magnifying-glass" />
          <span className="commerce-page-header__search-label">Search</span>
        </a>
        <button
          className="product-cart-pill"
          onClick={openCart}
          type="button"
          title="View cart"
          aria-label={'Open cart, ' + count + ' ' + (count === 1 ? 'item' : 'items')}
        >
          <i className="fa-solid fa-bag-shopping" />
          <span>{count}</span>
        </button>
      </div>
    </header>
  );
}
