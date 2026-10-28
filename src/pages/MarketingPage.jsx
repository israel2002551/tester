import { useEffect, useRef, useState } from 'react';
import BrandLogo from '../components/BrandLogo.jsx';
import { landingCategories, naira, useLandingCatalog } from '../lib/landingData.js';
import '../styles/landing.css';

const rotatingWords = ['fashion', 'phones', 'home finds', 'beauty', 'gadgets'];

const quickLinks = [
  ['Fashion', '/category/fashion'],
  ['Phones', '/category/phones'],
  ['Home', '/category/home'],
  ['Beauty', '/category/beauty'],
  ['Electronics', '/category/electronics'],
  ['1688 sourcing', '/category/dropship'],
];

const tickerItems = [
  ['fa-gift', 'Free gifts on qualifying orders'],
  ['fa-truck-fast', '₦2,500 flat doorstep delivery'],
  ['fa-location-dot', 'Free pickup at verified Safe Hubs'],
  ['fa-shield-halved', 'Every payment checked by BUYSELL'],
  ['fa-boxes-stacked', '1688 sourcing for growing stores'],
  ['fa-comments', 'Chat with sellers before you buy'],
];

const steps = [
  ['fa-magnifying-glass', 'Find it', 'Search hundreds of live listings or browse by category.'],
  ['fa-building-columns', 'Pay BUYSELL', 'Transfer to BUYSELL’s account and upload your receipt.'],
  ['fa-shield-halved', 'We verify', 'An admin confirms your payment before the order moves.'],
  ['fa-box-open', 'Receive it', 'Doorstep delivery, or collect free from a Safe Hub.'],
];

const reducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useRotatingWord(words, interval = 2200) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const timer = setInterval(() => setIndex(current => (current + 1) % words.length), interval);
    return () => clearInterval(timer);
  }, [words, interval]);
  return [words[index], index];
}

/** Adds `is-in` to `.bh-reveal` elements as they scroll into view. */
function useReveal(rootRef, deps) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const targets = root.querySelectorAll('.bh-reveal:not(.is-in)');
    if (!('IntersectionObserver' in window) || reducedMotion()) {
      targets.forEach(node => node.classList.add('is-in'));
      return undefined;
    }
    root.classList.add('bh-animate');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) return undefined;
    if (reducedMotion()) { setValue(target); return undefined; }
    let frame;
    const start = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function SearchForm({ id, large = false }) {
  const submit = event => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get('q')?.toString().trim() || '';
    window.location.href = query ? `/?view=shop&q=${encodeURIComponent(query)}` : '/?view=shop';
  };
  return (
    <form className={`bh-search${large ? ' bh-search--large' : ''}`} role="search" onSubmit={submit}>
      <label htmlFor={id} className="bh-sr-only">Search BUYSELL</label>
      <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
      <input id={id} name="q" type="search" autoComplete="off" placeholder="Search sneakers, iPhones, blenders…" />
      <button type="submit">Search</button>
    </form>
  );
}

function ProductCard({ product, className = '' }) {
  const discount = Number(product.original_price) > Number(product.price)
    ? Math.round((1 - Number(product.price) / Number(product.original_price)) * 100)
    : 0;
  const isNew = Date.now() - new Date(product.created_at).getTime() < 3 * 86400000;
  return (
    <a className={`bh-card ${className}`.trim()} href={`/product?id=${encodeURIComponent(product.id)}`}>
      <span className="bh-card-media">
        <img src={product.image} alt="" loading="lazy" decoding="async" />
        {discount >= 5 ? <em className="bh-card-badge bh-card-badge--deal">-{discount}%</em>
          : isNew ? <em className="bh-card-badge">New</em> : null}
      </span>
      <span className="bh-card-body">
        <span className="bh-card-name">{product.name}</span>
        <span className="bh-card-price">
          <strong>{naira(product.price)}</strong>
          {discount >= 5 ? <s>{naira(product.original_price)}</s> : null}
        </span>
      </span>
    </a>
  );
}

function SkeletonCard({ className = '' }) {
  return (
    <span className={`bh-card bh-card--skeleton ${className}`.trim()} aria-hidden="true">
      <span className="bh-card-media" />
      <span className="bh-card-body"><span className="bh-skel-line" /><span className="bh-skel-line bh-skel-line--short" /></span>
    </span>
  );
}

function HeroShowcase({ status, products }) {
  // One product per category where possible, so the stack shows variety.
  const picks = [];
  const seen = new Set();
  for (const product of products) {
    if (picks.length === 3) break;
    if (!seen.has(product.category)) { picks.push(product); seen.add(product.category); }
  }
  for (const product of products) {
    if (picks.length === 3) break;
    if (!picks.includes(product)) picks.push(product);
  }

  if (status === 'error' || (status === 'ready' && picks.length < 3)) {
    return (
      <div className="bh-showcase bh-showcase--photo">
        <img src="/images/marketing/buysell-marketplace-real-v1.jpg" alt="Nigerian market seller at her stall" />
        <span className="bh-chip bh-chip--gift"><i className="fa-solid fa-gift" /> Free gifts on qualifying orders</span>
        <span className="bh-chip bh-chip--delivery"><i className="fa-solid fa-truck-fast" /> ₦2,500 flat delivery</span>
      </div>
    );
  }

  return (
    <div className="bh-showcase" aria-label="Products on BUYSELL right now">
      <span className="bh-showcase-glow" aria-hidden="true" />
      {status === 'loading'
        ? [1, 2, 3].map(n => <SkeletonCard key={n} className={`bh-float bh-float--${n}`} />)
        : picks.map((product, index) => (
          <ProductCard key={product.id} product={product} className={`bh-float bh-float--${index + 1}`} />
        ))}
      <span className="bh-chip bh-chip--gift"><i className="fa-solid fa-gift" /> Free gift unlocked</span>
      <span className="bh-chip bh-chip--verified"><i className="fa-solid fa-circle-check" /> Payment verified</span>
      <span className="bh-chip bh-chip--delivery"><i className="fa-solid fa-truck-fast" /> ₦2,500 flat delivery</span>
    </div>
  );
}

function ProductRail({ status, products }) {
  const railRef = useRef(null);
  const scroll = direction => {
    const rail = railRef.current;
    if (rail) rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  if (status === 'error' || (status === 'ready' && !products.length)) return null;
  return (
    <section className="bh-section bh-fresh" aria-labelledby="bh-fresh-title">
      <div className="bh-head bh-reveal">
        <div>
          <span className="bh-kicker"><i className="fa-solid fa-bolt" /> Just landed</span>
          <h2 id="bh-fresh-title">Fresh on BUYSELL</h2>
        </div>
        <div className="bh-head-actions">
          <button type="button" className="bh-arrow" onClick={() => scroll(-1)} aria-label="Scroll back"><i className="fa-solid fa-arrow-left" /></button>
          <button type="button" className="bh-arrow" onClick={() => scroll(1)} aria-label="Scroll forward"><i className="fa-solid fa-arrow-right" /></button>
          <a className="bh-link" href="/?view=shop">See everything <i className="fa-solid fa-arrow-right" /></a>
        </div>
      </div>
      <div className="bh-rail" ref={railRef}>
        {status === 'loading'
          ? Array.from({ length: 6 }, (_, n) => <SkeletonCard key={n} />)
          : products.slice(0, 16).map(product => <ProductCard key={product.id} product={product} />)}
      </div>
    </section>
  );
}

function CategoryGrid({ categories }) {
  return (
    <section className="bh-section" aria-labelledby="bh-cat-title">
      <div className="bh-head bh-reveal">
        <div>
          <span className="bh-kicker"><i className="fa-solid fa-shapes" /> Shop by category</span>
          <h2 id="bh-cat-title">Where do you want to start?</h2>
        </div>
        <a className="bh-link" href="/products">All categories <i className="fa-solid fa-arrow-right" /></a>
      </div>
      <div className="bh-cats">
        {landingCategories.map((category, index) => {
          const info = categories[category.key] || {};
          return (
            <a key={category.key} href={category.href}
              className={`bh-cat bh-reveal${index === 0 ? ' bh-cat--hero' : ''}${info.cover ? '' : ' bh-cat--plain'}`}
              style={{ '--bh-delay': `${index * 70}ms` }}>
              {info.cover ? <img src={info.cover} alt="" loading="lazy" decoding="async" /> : null}
              <span className="bh-cat-icon"><i className={`fa-solid ${category.icon}`} aria-hidden="true" /></span>
              <span className="bh-cat-copy">
                <strong>{category.name}</strong>
                <span>{info.count ? `${info.count.toLocaleString('en-NG')} items` : 'Browse now'} <i className="fa-solid fa-arrow-right" /></span>
              </span>
            </a>
          );
        })}
        <a href="/category/dropship" className="bh-cat bh-cat--source bh-reveal" style={{ '--bh-delay': '350ms' }}>
          <span className="bh-cat-icon"><i className="fa-solid fa-boxes-stacked" aria-hidden="true" /></span>
          <span className="bh-cat-copy">
            <strong>1688 sourcing</strong>
            <span>Bulk orders for your store <i className="fa-solid fa-arrow-right" /></span>
          </span>
        </a>
      </div>
    </section>
  );
}

export default function MarketingPage() {
  const rootRef = useRef(null);
  const catalog = useLandingCatalog();
  const [word, wordIndex] = useRotatingWord(rotatingWords);
  const liveCount = useCountUp(catalog.total || 0);
  useReveal(rootRef, [catalog.status]);

  useEffect(() => {
    document.body.className = '';
    document.title = 'BUYSELL Nigeria | Shop fashion, phones, home and beauty the safe way';
  }, []);

  return (
    <main className="bh" ref={rootRef}>
      <section className="bh-hero" aria-labelledby="bh-hero-title">
        <header className="bh-nav" aria-label="BUYSELL navigation">
          <a className="bh-brand" href="/" aria-label="BUYSELL Nigeria home">
            <BrandLogo variant="transparent" decorative />
          </a>
          <nav aria-label="Primary navigation">
            <a href="/?view=shop">Marketplace</a>
            <a href="/products">Categories</a>
            <a href="/category/dropship">1688 Sourcing</a>
            <a href="/?view=shop&entry=seller&mode=signup">Sell</a>
          </nav>
          <div className="bh-nav-actions">
            <a className="bh-nav-signin" href="/?view=shop&entry=buyer&mode=login">Sign in</a>
            <a className="bh-btn bh-btn--dark" href="/?view=shop">Shop now</a>
          </div>
        </header>

        <div className="bh-hero-grid">
          <div className="bh-hero-copy">
            <span className="bh-live">
              <span className="bh-live-dot" aria-hidden="true" />
              {catalog.total ? <><strong>{liveCount.toLocaleString('en-NG')}</strong>&nbsp;products live now</> : 'Nigeria’s connected marketplace'}
            </span>
            <h1 id="bh-hero-title">
              <span className="bh-sr-only">Shop fashion, phones, home finds and beauty the safe way.</span>
              <span aria-hidden="true">
                Shop
                <span className="bh-rotator"><span key={wordIndex} className="bh-rotator-word">{word}</span></span>
                the safe way.
              </span>
            </h1>
            <p className="bh-hero-lede">
              Pay BUYSELL, not a stranger. We check every payment before your order moves, then deliver to your
              door for a flat ₦2,500, or you collect it free from a verified Safe Hub.
            </p>
            <SearchForm id="bh-hero-search" large />
            <div className="bh-quick" aria-label="Popular categories">
              {quickLinks.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
            </div>
          </div>
          <HeroShowcase status={catalog.status} products={catalog.products} />
        </div>
      </section>

      <div className="bh-ticker" aria-label="BUYSELL offers">
        <div className="bh-ticker-track">
          {[0, 1].map(copy => (
            <ul key={copy} aria-hidden={copy === 1 || undefined}>
              {tickerItems.map(([icon, text]) => <li key={text}><i className={`fa-solid ${icon}`} /> {text}</li>)}
            </ul>
          ))}
        </div>
      </div>

      <ProductRail status={catalog.status} products={catalog.products} />

      <section className="bh-section" aria-labelledby="bh-perks-title">
        <div className="bh-head bh-reveal">
          <div>
            <span className="bh-kicker"><i className="fa-solid fa-star" /> Why shop here</span>
            <h2 id="bh-perks-title">Better deals, fewer worries</h2>
          </div>
        </div>
        <div className="bh-perks">
          <article className="bh-perk bh-perk--gift bh-reveal">
            <span className="bh-perk-icon"><i className="fa-solid fa-gift" /></span>
            <h3>A free gift with your order</h3>
            <p>Qualifying orders unlock a free gift from the BUYSELL catalogue. Pick it at checkout. The gift ships with your order at no extra delivery cost.</p>
            <a className="bh-btn bh-btn--dark" href="/?view=shop">Start shopping <i className="fa-solid fa-arrow-right" /></a>
            <span className="bh-perk-ribbon" aria-hidden="true"><i className="fa-solid fa-gift" /></span>
          </article>
          <article className="bh-perk bh-perk--delivery bh-reveal" style={{ '--bh-delay': '80ms' }}>
            <span className="bh-perk-icon"><i className="fa-solid fa-truck-fast" /></span>
            <span className="bh-perk-figure">₦2,500</span>
            <h3>Flat doorstep delivery</h3>
            <p>One fee per order, even when your items come from different stores.</p>
          </article>
          <article className="bh-perk bh-perk--pickup bh-reveal" style={{ '--bh-delay': '160ms' }}>
            <span className="bh-perk-icon"><i className="fa-solid fa-location-dot" /></span>
            <span className="bh-perk-figure">Free</span>
            <h3>Safe Hub pickup</h3>
            <p>Collect from a verified pickup hub near you and pay nothing for delivery.</p>
          </article>
          <article className="bh-perk bh-perk--trust bh-reveal" style={{ '--bh-delay': '240ms' }}>
            <span className="bh-perk-icon"><i className="fa-solid fa-shield-halved" /></span>
            <div>
              <h3>Your money is checked first</h3>
              <p>You pay into BUYSELL’s account and upload the receipt. An admin verifies it before any seller is involved, and you can chat with the seller in the app.</p>
            </div>
          </article>
        </div>
      </section>

      <CategoryGrid categories={catalog.categories} />

      <section className="bh-steps-wrap" aria-labelledby="bh-steps-title">
        <div className="bh-section">
          <div className="bh-head bh-head--center bh-reveal">
            <span className="bh-kicker bh-kicker--light"><i className="fa-solid fa-route" /> How it works</span>
            <h2 id="bh-steps-title">From “I want this” to “it’s here” in four steps</h2>
          </div>
          <ol className="bh-steps">
            {steps.map(([icon, title, text], index) => (
              <li key={title} className="bh-step bh-reveal" style={{ '--bh-delay': `${index * 110}ms` }}>
                <span className="bh-step-num">{index + 1}</span>
                <span className="bh-step-icon"><i className={`fa-solid ${icon}`} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bh-section bh-split" aria-label="Sell and source with BUYSELL">
        <a className="bh-split-card bh-split-card--sell bh-reveal" href="/?view=shop&entry=seller&mode=signup">
          <img src="/images/marketing/buysell-marketplace-real-v1.jpg" alt="" loading="lazy" />
          <span className="bh-split-copy">
            <span className="bh-kicker bh-kicker--light">For sellers</span>
            <strong>Open your store in minutes</strong>
            <span>List products, take orders, chat with buyers and track payouts from one dashboard.</span>
            <em>Start selling <i className="fa-solid fa-arrow-right" /></em>
          </span>
        </a>
        <a className="bh-split-card bh-split-card--source bh-reveal" href="/category/dropship" style={{ '--bh-delay': '100ms' }}>
          <img src="/images/marketing/buysell-sourcing-real-v1.jpg" alt="" loading="lazy" />
          <span className="bh-split-copy">
            <span className="bh-kicker bh-kicker--light">For growing stores</span>
            <strong>Source in bulk from 1688</strong>
            <span>Collect product requests and export supplier-ready batches when you are ready to order.</span>
            <em>Explore sourcing <i className="fa-solid fa-arrow-right" /></em>
          </span>
        </a>
      </section>

      <section className="bh-final" aria-labelledby="bh-final-title">
        <div className="bh-final-inner bh-reveal">
          <h2 id="bh-final-title">Your next favourite thing is one search away.</h2>
          <SearchForm id="bh-final-search" />
          <div className="bh-final-actions">
            <a className="bh-btn bh-btn--gold" href="/?view=shop">Browse the marketplace <i className="fa-solid fa-arrow-right" /></a>
            <a className="bh-btn bh-btn--outline" href="/?view=shop&entry=seller&mode=signup">Open a store</a>
          </div>
        </div>
      </section>

      <footer className="bh-footer">
        <div>
          <BrandLogo variant="transparent" className="bh-footer-logo" />
          <p>Shop, sell and source across Nigeria with every payment checked by BUYSELL.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="/?view=shop">Marketplace</a>
          <a href="/products">Categories</a>
          <a href="/category/dropship">1688 Sourcing</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </main>
  );
}
