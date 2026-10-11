
import { useEffect, useMemo, useState } from 'react';
import BrandLogo from '../components/BrandLogo.jsx';
import { createSupabaseClient } from '../lib/browserConfig.js';
import { money } from '../lib/format.js';

const categories = [
  { label: 'Fashion', icon: 'fa-shirt', href: '/category/fashion', note: 'Style' },
  { label: 'Phones', icon: 'fa-mobile-screen-button', href: '/category/phones', note: 'Tech' },
  { label: 'Home', icon: 'fa-couch', href: '/category/home', note: 'Living' },
  { label: 'Beauty', icon: 'fa-wand-magic-sparkles', href: '/category/beauty', note: 'Care' },
  { label: 'Bulk & sourcing', icon: 'fa-boxes-stacked', href: '/category/dropship', note: 'Business' },
];

const productColumnFallbacks = [
  'id,name,price,original_price,image_url,images,category,status,created_at',
  'id,name,price,original_price,image_url,category,status,created_at',
  'id,name,price,image_url,category,status,created_at',
];

function productImage(product) {
  if (product?.image_url) return product.image_url;
  if (Array.isArray(product?.images) && product.images.length) return product.images[0];
  return '';
}

async function loadFeaturedProducts() {
  const db = await createSupabaseClient();
  let lastError = null;
  for (const columns of productColumnFallbacks) {
    for (const status of ['active', 'approved']) {
      const { data, error } = await db
        .from('products')
        .select(columns)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(8);
      if (!error) return data || [];
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

function ProductCard({ product }) {
  const image = productImage(product);
  return (
    <a className="bs-market-product-card" href={'/product?id=' + encodeURIComponent(product.id)}>
      <div className="bs-market-product-card__media">
        {image
          ? <img src={image} alt={product.name || 'Product'} loading="lazy" />
          : <span className="bs-market-product-card__empty"><i className="fa-solid fa-bag-shopping" /></span>}
      </div>
      <div className="bs-market-product-card__meta">
        <div className="bs-market-product-card__name">{product.name || 'Product'}</div>
        <div className="bs-market-product-card__price">
          {money(product.price)}
          {Number(product.original_price) > Number(product.price)
            ? <s>{money(product.original_price)}</s>
            : null}
        </div>
      </div>
    </a>
  );
}

function HeroVisual({ products }) {
  const visualProducts = useMemo(() => products.slice(0, 3), [products]);
  return (
    <div className="bs-market-hero__visual" aria-label="Products available on BUYSELL">
      <div className="bs-hero-product-stack">
        {[0, 1, 2].map(index => {
          const product = visualProducts[index];
          const image = productImage(product);
          const fallbackIcon = categories[index]?.icon || 'fa-bag-shopping';
          return (
            <div className="bs-hero-product" key={product?.id || index}>
              {image
                ? <img src={image} alt={product?.name || ''} />
                : <div className="bs-hero-product__placeholder"><i className={'fa-solid ' + fallbackIcon} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MarketingPage() {
  const [products, setProducts] = useState([]);
  const [productState, setProductState] = useState('loading');

  useEffect(() => {
    document.body.className = 'bs-redesign';
    document.title = 'BUYSELL Nigeria | Shop, Sell and Source';
    let cancelled = false;

    loadFeaturedProducts()
      .then(rows => {
        if (cancelled) return;
        setProducts(rows);
        setProductState('ready');
      })
      .catch(error => {
        console.warn('Landing products could not load:', error);
        if (!cancelled) setProductState('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bs-market-page">
      <nav className="bs-market-nav">
        <div className="bs-market-nav__inner">
          <a href="/" aria-label="BUYSELL home"><BrandLogo variant="transparent" /></a>
          <div className="bs-market-nav__links">
            <a href="/?view=shop">Shop</a>
            <a href="/products">Categories</a>
            <a href="/?view=shop&entry=seller&mode=signup">Sell</a>
            <a href="/category/dropship">Bulk & sourcing</a>
          </div>
          <div className="bs-market-nav__actions">
            <a className="bs-market-nav__signin" href="/?entry=buyer&mode=login">Sign in</a>
            <a className="bs-market-nav__sell" href="/?entry=seller&mode=signup">Start selling</a>
          </div>
        </div>
      </nav>

      <main>
        <section className="bs-market-hero">
          <div className="bs-market-hero__copy">
            <span className="bs-market-eyebrow">BUYSELL Nigeria</span>
            <h1>Find it. <span>Buy it.</span> Sell it.</h1>
            <p className="bs-market-hero__sub">
              A cleaner marketplace for everyday shopping, stores and bulk business.
            </p>
            <div className="bs-market-hero__actions">
              <a className="bs-market-hero__primary" href="/?view=shop">
                Shop now <i className="fa-solid fa-arrow-right" />
              </a>
              <a className="bs-market-hero__secondary" href="/?entry=seller&mode=signup">
                Open a store
              </a>
            </div>
            <div className="bs-market-hero__proof">
              <span><i className="fa-solid fa-shield-halved" /> Verified seller checks</span>
              <span><i className="fa-solid fa-truck-fast" /> BUYSELL delivery</span>
              <span><i className="fa-solid fa-lock" /> Secure order flow</span>
            </div>
          </div>
          <HeroVisual products={products} />
        </section>

        <section className="bs-market-section">
          <div className="bs-market-section__head">
            <div>
              <span className="bs-market-eyebrow">Explore</span>
              <h2>Shop by category</h2>
            </div>
            <a href="/products">See all</a>
          </div>
          <div className="bs-category-rail">
            {categories.map(category => (
              <a className="bs-category-tile" href={category.href} key={category.label}>
                <i className={'fa-solid ' + category.icon} />
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.note}</small>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="bs-market-section">
          <div className="bs-market-section__head">
            <div>
              <span className="bs-market-eyebrow">Marketplace</span>
              <h2>Fresh on BUYSELL</h2>
            </div>
            <a href="/?view=shop">View marketplace</a>
          </div>

          {productState === 'loading' ? (
            <div className="bs-product-showcase" aria-label="Loading products">
              {Array.from({ length: 8 }, (_, index) => (
                <div className="bs-market-product-card" key={index}>
                  <div className="bs-market-product-card__media skeleton" />
                  <div className="bs-market-product-card__meta">
                    <div className="skeleton" style={{ height: 16, marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 16, width: '48%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : products.length ? (
            <div className="bs-product-showcase">
              {products.map(product => <ProductCard product={product} key={product.id} />)}
            </div>
          ) : (
            <div className="bs-category-tile" style={{ minHeight: 130 }}>
              <i className="fa-solid fa-store" />
              <span>
                <strong>Marketplace is ready</strong>
                <small>{productState === 'error' ? 'Open the marketplace to browse available products.' : 'Products will appear here as they are listed.'}</small>
              </span>
            </div>
          )}
        </section>

        <section className="bs-market-business">
          <div className="bs-market-business__card">
            <div className="bs-market-business__copy">
              <span className="bs-market-eyebrow" style={{ color: '#fff' }}>For business</span>
              <h2>Sell retail. Sell bulk. Keep it in one store.</h2>
              <p>
                Seller and wholesaler journeys use the same BUYSELL account, with products,
                orders, messages and sourcing tools kept together.
              </p>
              <a href="/?entry=seller&mode=signup">
                Start selling <i className="fa-solid fa-arrow-right" />
              </a>
            </div>
            <div className="bs-market-business__visual" aria-hidden="true" />
          </div>
        </section>

        <section className="bs-trust-row" aria-label="BUYSELL service highlights">
          <div><i className="fa-solid fa-shield-halved" /><span><strong>Seller checks</strong><small>Trust signals</small></span></div>
          <div><i className="fa-solid fa-box" /><span><strong>Order tracking</strong><small>Clear progress</small></span></div>
          <div><i className="fa-solid fa-message" /><span><strong>Marketplace chat</strong><small>Talk in context</small></span></div>
          <div><i className="fa-solid fa-headset" /><span><strong>BUYSELL support</strong><small>When you need help</small></span></div>
        </section>
      </main>

      <footer className="bs-market-footer">
        <div className="bs-market-footer__inner">
          <BrandLogo variant="light" />
          <div className="bs-market-footer__links">
            <a href="/?view=shop">Marketplace</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/category/dropship">Bulk & sourcing</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
