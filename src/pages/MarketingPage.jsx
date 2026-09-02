import { useEffect } from 'react';

const categories = [
  {
    name: 'Fashion',
    count: 'Curated apparel',
    image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=700&q=85&auto=format&fit=crop',
    href: '/category/fashion',
  },
  {
    name: 'Phones',
    count: 'Devices and accessories',
    image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=700&q=85&auto=format&fit=crop',
    href: '/category/phones',
  },
  {
    name: 'Home',
    count: 'Living and decor',
    image: 'https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=700&q=85&auto=format&fit=crop',
    href: '/category/home',
  },
  {
    name: 'Beauty',
    count: 'Skincare and fragrance',
    image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=700&q=85&auto=format&fit=crop',
    href: '/category/beauty',
  },
  {
    name: '1688 Sourcing',
    count: 'Bulk order tools',
    image: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=700&q=85&auto=format&fit=crop',
    href: '/?view=1688',
  },
];

const products = [
  {
    name: 'Verified fashion drops',
    price: 'From NGN 12,500',
    badge: 'Trending',
    image: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&q=85&auto=format&fit=crop',
  },
  {
    name: 'Smart devices',
    price: 'Bulk ready',
    badge: '1688',
    image: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=600&q=85&auto=format&fit=crop',
  },
  {
    name: 'Beauty essentials',
    price: 'Seller verified',
    badge: 'New',
    image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&q=85&auto=format&fit=crop',
  },
  {
    name: 'Home upgrades',
    price: 'Nationwide delivery',
    badge: 'Protected',
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&q=85&auto=format&fit=crop',
  },
];

const trustItems = [
  ['fa-truck-fast', 'Nationwide Delivery', 'BUYSELL pickup, handoff checks, and order updates.'],
  ['fa-shield-halved', 'Verified Checkout', 'Transfer to BUYSELL and upload your receipt for admin verification.'],
  ['fa-comments', 'In-App Chat', 'Buyer and seller messages stay attached to the order.'],
  ['fa-store', 'Seller Tools', 'Roles, products, sourcing, payouts, and order management.'],
];

const steps = [
  ['01', 'Discover', 'Browse verified Nigerian products or import 1688 links in bulk.'],
  ['02', 'Checkout', 'Pay securely, choose delivery or pickup, and keep proof in-app.'],
  ['03', 'Manage', 'Sellers track orders, chat, export CSV/XLS, and send supplier batches.'],
];

export default function MarketingPage() {
  useEffect(() => {
    document.body.className = '';
    document.title = 'BUYSELL Nigeria | Buy, sell, source, and deliver with trust';
  }, []);

  const goShop = () => {
    window.location.href = '/?view=shop';
  };

  const goSellerSignup = () => {
    window.location.href = '/?entry=seller&mode=signup';
  };

  return (
    <main className="bs-landing bs-lux">
      <header className="bs-lux-nav" aria-label="BUYSELL landing navigation">
        <a className="bs-lux-brand" href="/">
          <span className="bs-lux-mark">B</span>
          <span className="logo-text"><span>BUY</span><span>SELL</span></span>
        </a>
        <nav>
          <a href="/?view=shop">Marketplace</a>
          <a href="/products">Collections</a>
          <a href="/?view=1688">1688 Sourcing</a>
          <a href="/terms">Trust</a>
        </nav>
        <div className="bs-lux-nav-actions">
          <button type="button" className="bs-lux-icon-btn" aria-label="Search marketplace" onClick={goShop}>
            <i className="fa-solid fa-magnifying-glass" />
          </button>
          <button type="button" className="bs-lux-text-btn" onClick={goSellerSignup}>Open Store</button>
        </div>
      </header>

      <section className="bs-lux-hero">
        <div className="bs-lux-hero-copy">
          <span className="bs-lux-kicker">New commerce workspace</span>
          <h1>Shop safer. Sell smarter. Source from 1688 in bulk.</h1>
          <p>
            BUYSELL gives Nigerian buyers and sellers a polished marketplace for product discovery,
            secure checkout, in-app chat, seller roles, delivery tracking, and supplier-ready CSV/XLS exports.
          </p>
          <div className="bs-lux-hero-actions">
            <button type="button" className="bs-btn bs-btn--primary" onClick={goShop}>
              <span>Shop Marketplace</span>
              <i className="fa-solid fa-arrow-right" />
            </button>
            <button type="button" className="bs-btn bs-btn--ghost" onClick={goSellerSignup}>
              Start Selling
            </button>
          </div>
          <div className="bs-lux-proof-row">
            <span><i className="fa-solid fa-star" /> 4.9 buyer trust flow</span>
            <span><i className="fa-solid fa-lock" /> Secure checkout</span>
            <span><i className="fa-solid fa-file-csv" /> Bulk CSV/XLS</span>
          </div>
        </div>

        <div className="bs-lux-hero-media" aria-label="BUYSELL product marketplace preview">
          <img
            src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1100&q=90&auto=format&fit=crop"
            alt="Online marketplace checkout and shopping workflow"
          />
          <article className="bs-lux-floating-card bs-lux-floating-card--product">
            <img
              src="https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=260&q=85&auto=format&fit=crop"
              alt="Curated marketplace product"
            />
            <div>
              <strong>Verified marketplace deals</strong>
              <span>Checkout, chat, and delivery in one place</span>
            </div>
          </article>
          <article className="bs-lux-floating-card bs-lux-floating-card--stats">
            <strong>1688 queue</strong>
            <span>Export supplier orders as CSV or XLS</span>
          </article>
        </div>
      </section>

      <section className="bs-lux-trust" aria-label="BUYSELL value propositions">
        {trustItems.map(([icon, title, text]) => (
          <article key={title}>
            <i className={`fa-solid ${icon}`} />
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="bs-lux-categories">
        <div className="bs-lux-section-head">
          <div>
            <span className="bs-lux-kicker">Shop by category</span>
            <h2>Browse Nigerian products with a premium shopping feel</h2>
          </div>
          <a href="/products">View all <i className="fa-solid fa-arrow-right" /></a>
        </div>
        <div className="bs-lux-category-row">
          {categories.map(category => (
            <a className="bs-lux-category" href={category.href} key={category.name}>
              <img src={category.image} alt={`${category.name} category`} loading="lazy" />
              <strong>{category.name}</strong>
              <span>{category.count}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="bs-lux-promo">
        <div className="bs-lux-promo-copy">
          <span className="bs-lux-kicker">Seller and sourcing tools</span>
          <h2>One dashboard for products, team access, bulk sourcing, and supplier files.</h2>
          <p>
            Store managers, product managers, and admins can work from the same seller space,
            then aggregate 1688 and dropshipping orders into supplier-ready spreadsheets.
          </p>
          <button type="button" className="bs-btn bs-btn--primary" onClick={goSellerSignup}>
            Open Seller Account
          </button>
        </div>
        <div className="bs-lux-promo-grid">
          <div><i className="fa-solid fa-user-shield" /><span>Full Admin</span></div>
          <div><i className="fa-solid fa-shop" /><span>Store Manager</span></div>
          <div><i className="fa-solid fa-boxes-stacked" /><span>Product Manager</span></div>
          <div><i className="fa-solid fa-file-export" /><span>CSV/XLS Export</span></div>
        </div>
      </section>

      <section className="bs-lux-products">
        <div className="bs-lux-section-head">
          <div>
            <span className="bs-lux-kicker">Featured flows</span>
            <h2>Marketplace-ready experiences for every order</h2>
          </div>
          <button type="button" onClick={goShop}>Explore products <i className="fa-solid fa-arrow-right" /></button>
        </div>
        <div className="bs-lux-product-grid">
          {products.map(product => (
            <article className="bs-lux-product" key={product.name}>
              <div className="bs-lux-product-media">
                <img src={product.image} alt={product.name} loading="lazy" />
                <span>{product.badge}</span>
                <button type="button" aria-label={`Save ${product.name}`}>
                  <i className="fa-regular fa-heart" />
                </button>
              </div>
              <div className="bs-lux-product-body">
                <h3>{product.name}</h3>
                <p>{product.price}</p>
                <div><i className="fa-solid fa-star" /> 4.8</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="bs-lux-steps">
        <div className="bs-lux-section-head bs-lux-section-head--center">
          <span className="bs-lux-kicker">How BUYSELL works</span>
          <h2>From discovery to delivery, every step has a page and a purpose.</h2>
        </div>
        <div className="bs-lux-step-grid">
          {steps.map(([number, title, text]) => (
            <article key={title}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bs-lux-newsletter">
        <div>
          <i className="fa-regular fa-envelope" />
          <div>
            <h2>Join the BUYSELL circle</h2>
            <p>Get marketplace updates, sourcing launches, and seller tool improvements.</p>
          </div>
        </div>
        <form onSubmit={event => event.preventDefault()}>
          <input type="email" placeholder="Enter your email" aria-label="Email address" />
          <button type="submit">Subscribe</button>
        </form>
      </section>

      <footer className="bs-lux-footer">
        <div>
          <strong>BUYSELL Nigeria</strong>
          <p>Buy, sell, source, checkout, chat, and deliver with stronger trust signals.</p>
        </div>
        <nav>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/?view=shop">Marketplace</a>
          <a href="/products">Products</a>
        </nav>
      </footer>
    </main>
  );
}
