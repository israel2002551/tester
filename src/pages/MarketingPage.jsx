import { useEffect } from 'react';
import BrandLogo from '../components/BrandLogo.jsx';

const categories = [
  {
    name: 'Fashion',
    description: 'Clothes, shoes, and everyday style.',
    icon: 'fa-shirt',
    theme: 'clay',
    href: '/category/fashion',
  },
  {
    name: 'Phones & gadgets',
    description: 'Devices, accessories, and upgrades.',
    icon: 'fa-mobile-screen-button',
    theme: 'mint',
    href: '/category/phones',
  },
  {
    name: 'Home & living',
    description: 'Useful pieces for every space.',
    icon: 'fa-couch',
    theme: 'cream',
    href: '/category/home',
  },
  {
    name: 'Beauty',
    description: 'Skincare, fragrance, and self-care.',
    icon: 'fa-wand-magic-sparkles',
    theme: 'rose',
    href: '/category/beauty',
  },
  {
    name: '1688 sourcing',
    description: 'Bulk-order tools for growing stores.',
    icon: 'fa-boxes-stacked',
    theme: 'gold',
    href: '/category/dropship',
  },
];

const journeys = [
  {
    eyebrow: 'For buyers',
    title: 'Find what you need, then check out with clarity.',
    text: 'Browse real categories, talk to a seller in context, and keep delivery or pickup updates connected to the order.',
    icon: 'fa-bag-shopping',
    href: '/?view=shop',
    action: 'Shop the marketplace',
    theme: 'shop',
  },
  {
    eyebrow: 'For sellers',
    title: 'Run your store from one focused workspace.',
    text: 'Manage products, orders, conversations, team roles, and payouts without mixing buyer tools into your dashboard.',
    icon: 'fa-store',
    href: '/?view=shop&entry=seller&mode=signup',
    action: 'Open a seller store',
    theme: 'sell',
  },
  {
    eyebrow: 'For sourcing',
    title: 'Turn 1688 requests into supplier-ready batches.',
    text: 'Collect requests, keep procurement chats in one thread, and export organised CSV or XLS files when you are ready.',
    icon: 'fa-arrow-right-arrow-left',
    href: '/category/dropship',
    action: 'Explore 1688 sourcing',
    theme: 'source',
  },
];

const trustItems = [
  ['fa-truck-fast', 'Clear delivery updates', 'Pickup, handoff checks, and order status stay in one flow.'],
  ['fa-shield-halved', 'Verified checkout', 'Payment proof and order review are handled inside BUYSELL.'],
  ['fa-comments', 'Order-linked chat', 'Conversations stay with the product or sourcing request they relate to.'],
  ['fa-store', 'Focused seller tools', 'Buyer pages and seller workspaces remain purposefully separate.'],
];

const steps = [
  ['01', 'Choose a route', 'Start in the marketplace, open a store, or create a 1688 sourcing request.'],
  ['02', 'Keep it in context', 'Products, payments, messages, and delivery updates stay tied to the same order.'],
  ['03', 'Move with confidence', 'Use the next page that fits your role instead of being bounced through an auth modal.'],
];

export default function MarketingPage() {
  useEffect(() => {
    document.body.className = '';
    document.title = 'BUYSELL Nigeria | Buy, sell, and source with confidence';
  }, []);

  return (
    <main className="bs-landing bs-lux">
      <header className="bs-lux-nav" aria-label="BUYSELL landing navigation">
        <a className="bs-lux-brand" href="/" aria-label="BUYSELL Nigeria home">
          <BrandLogo variant="light" decorative />
        </a>
        <nav aria-label="Primary navigation">
          <a href="/?view=shop">Marketplace</a>
          <a href="/products">Categories</a>
          <a href="/category/dropship">1688 Sourcing</a>
          <a href="/terms">How trust works</a>
        </nav>
        <div className="bs-lux-nav-actions">
          <a className="bs-lux-icon-btn" href="/?view=shop" aria-label="Search marketplace">
            <i className="fa-solid fa-magnifying-glass" />
          </a>
          <a className="bs-lux-text-btn" href="/?view=shop&entry=seller&mode=signup">Open Store</a>
        </div>
      </header>

      <section className="bs-lux-hero bs-market-hero" aria-labelledby="market-hero-title">
        <div className="bs-lux-hero-copy">
          <span className="bs-lux-kicker">Nigeria&apos;s connected marketplace</span>
          <h1 id="market-hero-title">Buy with ease. Sell with structure. Source without the chaos.</h1>
          <p>
            BUYSELL brings shopping, secure order steps, seller workspaces, delivery updates,
            and 1688 sourcing together—while keeping each journey on its own clear page.
          </p>
          <div className="bs-lux-hero-actions">
            <a className="bs-btn bs-btn--primary" href="/?view=shop">
              <span>Shop Marketplace</span>
              <i className="fa-solid fa-arrow-right" />
            </a>
            <a className="bs-btn bs-btn--ghost" href="/?view=shop&entry=seller&mode=signup">
              Start Selling
            </a>
          </div>
          <ul className="bs-lux-proof-row" aria-label="BUYSELL benefits">
            <li><i className="fa-solid fa-lock" /> Protected order flow</li>
            <li><i className="fa-solid fa-message" /> Contextual chat</li>
            <li><i className="fa-solid fa-file-export" /> Supplier-ready exports</li>
          </ul>
        </div>

        <div className="bs-lux-hero-media" aria-label="Nigerian market seller">
          <picture>
            <source media="(max-width: 640px)" srcSet="/images/marketing/buysell-marketplace-real-v1.jpg" />
            <img
              src="/images/marketing/buysell-marketplace-real-v1.jpg"
              alt="Nigerian market seller at her fresh produce stall"
            />
          </picture>
          <article className="bs-lux-floating-card bs-lux-floating-card--stats">
            <i className="fa-solid fa-shield-heart" aria-hidden="true" />
            <strong>One clear order flow</strong>
            <span>Shop, chat, pay, and follow delivery without losing context.</span>
          </article>
          <article className="bs-lux-floating-card bs-lux-floating-card--product">
            <span className="bs-lux-mini-package" aria-hidden="true"><i className="fa-solid fa-box" /></span>
            <div>
              <strong>Built for everyday trade</strong>
              <span>Fashion, phones, home, beauty, and bulk sourcing.</span>
            </div>
          </article>
        </div>
      </section>

      <section className="bs-lux-trust" aria-label="BUYSELL value propositions">
        {trustItems.map(([icon, title, text]) => (
          <article key={title}>
            <i className={`fa-solid ${icon}`} aria-hidden="true" />
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="bs-lux-journeys" aria-labelledby="journeys-title">
        <div className="bs-lux-section-head">
          <div>
            <span className="bs-lux-kicker">Choose your journey</span>
            <h2 id="journeys-title">A home page that leads to the right next page</h2>
          </div>
          <p>Each route has its own purpose, so buyer tools, seller work, and sourcing activity never compete for the same space.</p>
        </div>
        <div className="bs-lux-journey-grid">
          {journeys.map(journey => (
            <a className={`bs-lux-journey bs-lux-journey--${journey.theme}`} href={journey.href} key={journey.title}>
              <span className="bs-lux-journey-icon"><i className={`fa-solid ${journey.icon}`} /></span>
              <span className="bs-lux-journey-eyebrow">{journey.eyebrow}</span>
              <h3>{journey.title}</h3>
              <p>{journey.text}</p>
              <span className="bs-lux-journey-link">{journey.action} <i className="fa-solid fa-arrow-right" /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="bs-lux-categories" aria-labelledby="category-title">
        <div className="bs-lux-section-head">
          <div>
            <span className="bs-lux-kicker">Shop by category</span>
            <h2 id="category-title">Find a product family before you start browsing</h2>
          </div>
          <a href="/products">View all categories <i className="fa-solid fa-arrow-right" /></a>
        </div>
        <div className="bs-lux-category-row">
          {categories.map(category => (
            <a className={`bs-lux-category bs-lux-category--${category.theme}`} href={category.href} key={category.name}>
              <span className="bs-lux-category-icon" aria-hidden="true"><i className={`fa-solid ${category.icon}`} /></span>
              <strong>{category.name}</strong>
              <span>{category.description}</span>
              <em>Browse <i className="fa-solid fa-arrow-right" /></em>
            </a>
          ))}
        </div>
      </section>

      <section className="bs-lux-promo" aria-labelledby="seller-tools-title">
        <div className="bs-lux-promo-copy">
          <span className="bs-lux-kicker">Seller and sourcing tools</span>
          <h2 id="seller-tools-title">From a product link to a supplier-ready batch, keep the work organised.</h2>
          <p>
            Build a seller workspace that stays separate from your buyer view, then collect 1688 and dropshipping requests into supplier-ready CSV or XLS files.
          </p>
          <ul className="bs-lux-promo-list">
            <li><i className="fa-solid fa-check" /> Role-aware seller dashboard</li>
            <li><i className="fa-solid fa-check" /> Dedicated sourcing chats and updates</li>
            <li><i className="fa-solid fa-check" /> Exportable supplier batches</li>
          </ul>
          <a className="bs-btn bs-btn--primary" href="/?view=shop&entry=seller&mode=signup">Open Seller Account</a>
        </div>
        <div className="bs-lux-promo-art">
          <img src="/images/marketing/buysell-sourcing-real-v1.jpg" alt="Nigerian craft seller working in a shoe workshop" loading="lazy" />
        </div>
      </section>

      <section className="bs-lux-steps" aria-labelledby="steps-title">
        <div className="bs-lux-section-head bs-lux-section-head--center">
          <span className="bs-lux-kicker">How BUYSELL works</span>
          <h2 id="steps-title">Every action has a destination, not a dead end.</h2>
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

      <section className="bs-lux-final-cta" aria-labelledby="final-cta-title">
        <div>
          <span className="bs-lux-kicker">Ready when you are</span>
          <h2 id="final-cta-title">Start with the side of BUYSELL that fits what you need today.</h2>
          <p>Shop now, open a store, or explore 1688 sourcing without crossing into the wrong workspace.</p>
        </div>
        <div className="bs-lux-final-cta-actions">
          <a className="bs-btn bs-btn--primary" href="/?view=shop">Shop now <i className="fa-solid fa-arrow-right" /></a>
          <a className="bs-btn bs-btn--ghost" href="/category/dropship">Explore sourcing</a>
        </div>
      </section>

      <footer className="bs-lux-footer">
        <div>
          <strong>BUYSELL Nigeria</strong>
          <p>Buy, sell, source, check out, chat, and deliver with a clearer journey from first click to final order.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/?view=shop">Marketplace</a>
          <a href="/products">Categories</a>
        </nav>
      </footer>
    </main>
  );
}
