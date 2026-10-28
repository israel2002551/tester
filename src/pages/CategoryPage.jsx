import { useEffect, useMemo, useState } from 'react';
import BrandHeader from '../components/BrandHeader.jsx';
import CategoryNav from '../components/CategoryNav.jsx';
import CategoryTrustBar from '../components/CategoryTrustBar.jsx';
import BrandLogo from '../components/BrandLogo.jsx';
import CartDrawer from '../components/CartDrawer.jsx';
import Pagination from '../components/Pagination.jsx';
import { CategoryProductCard, UpcomingProductCard } from '../components/CategoryProductCard.jsx';
import { createSupabaseClient } from '../lib/browserConfig.js';
import { cardImage, categoryConfig, categoryImages, categoryLinks, categoryProductColumns, upcomingColumns } from '../lib/categoryData.js';
import { money } from '../lib/format.js';
import '../styles/category.css';

const categoryColumnFallbacks = [
  categoryProductColumns,
  'id,seller_id,name,description,price,original_price,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,avg_rating,review_count',
  'id,seller_id,name,description,price,category,condition,location,image_url,status,created_at',
];

const ITEMS_PER_PAGE = 24;

function sortItems(items, sort, isUpcoming) {
  const sorted = [...items];
  if (sort === 'price-asc') sorted.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  else if (sort === 'price-desc') sorted.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  else if (sort === 'rating') {
    sorted.sort((a, b) => {
      if (isUpcoming) return Number(b.priority || 0) - Number(a.priority || 0);
      const bScore = Number(b.review_count || 0) * 3 + Number(b.avg_rating || 0) + (b.has_video ? 2 : 0);
      const aScore = Number(a.review_count || 0) * 3 + Number(a.avg_rating || 0) + (a.has_video ? 2 : 0);
      return bScore - aScore;
    });
  } else sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return sorted;
}

function normalizeCategory(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function categoryTitle(category = '') {
  return normalizeCategory(category)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function customCategoryConfig(category) {
  const title = categoryTitle(category) || 'Products';
  return {
    title,
    subtitle: `Browse active ${title.toLowerCase()} listings from BUYSELL sellers.`,
    icon: 'fa-tags',
    searchPlaceholder: `Search ${title.toLowerCase()}...`,
  };
}

function matchesCategory(product, category) {
  const target = normalizeCategory(category);
  if (target === 'all' || target === 'trending') return true;
  const value = normalizeCategory(product.category);
  const matchingTerms = {
    phones: ['phone', 'mobile', 'tablet', 'gadget', 'accessor'],
    electronics: ['electronics', 'electronic', 'laptop', 'computer', 'audio', 'television', 'tv', 'tech'],
    fashion: ['fashion', 'clothing', 'apparel', 'shoe', 'bag', 'watch'],
    home: ['home', 'furniture', 'kitchen', 'appliance', 'decor'],
    beauty: ['beauty', 'skincare', 'cosmetic', 'fragrance', 'perfume', 'personal care'],
    sports: ['sport', 'fitness', 'gym', 'activewear', 'outdoor'],
    dropship: ['dropship', '1688', 'sourcing'],
  };
  if (matchingTerms[target]) {
    return matchingTerms[target].some(term => value === term || value.includes(term));
  }
  // Seller-defined categories should stay separate rather than being mixed into
  // an unrelated built-in category.
  return value === target;
}

// Returns the category's rows and the whole active catalogue (used for the
// per-category counts on the category buttons).
async function fetchCategoryRows(db, category) {
  let lastError = null;
  let catalogue = null;
  for (const columns of categoryColumnFallbacks) {
    for (const status of ['active', 'approved']) {
      let allRows = [];
      let batchStart = 0;
      const BATCH_SIZE = 1000;
      let hasMore = true;
      let hadError = false;

      while (hasMore) {
        const query = db
          .from('products')
          .select(columns)
          .eq('status', status)
          .order('created_at', { ascending: false })
          .range(batchStart, batchStart + BATCH_SIZE - 1);
        const { data, error } = await query;
        if (error) {
          lastError = error;
          hadError = true;
          break;
        }
        const batch = data || [];
        allRows.push(...batch);
        if (batch.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          batchStart += BATCH_SIZE;
        }
      }

      if (hadError) continue;
      if (!catalogue) catalogue = allRows;

      const rows = allRows.filter(product => matchesCategory(product, category));
      if (rows.length || category === 'all' || category === 'trending') return { rows, allRows: catalogue };
    }
  }
  if (lastError && !catalogue) throw lastError;
  return { rows: [], allRows: catalogue || [] };
}

export default function CategoryPage({ category = 'all' }) {
  const normalizedCategory = normalizeCategory(category) || 'all';
  const isCustomCategory = !categoryConfig[normalizedCategory];
  const config = categoryConfig[normalizedCategory] || customCategoryConfig(normalizedCategory);
  const isUpcoming = normalizedCategory === 'upcoming';
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [sort, setSort] = useState(() => {
    const savedSort = new URLSearchParams(window.location.search).get('sort');
    return ['newest', 'price-asc', 'price-desc', 'rating'].includes(savedSort) ? savedSort : 'newest';
  });
  const [page, setPage] = useState(() => {
    const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [status, setStatus] = useState('loading');
  const [allRows, setAllRows] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    document.body.className = 'category-page';
    document.body.dataset.category = normalizedCategory;
    document.title = `${config.title} - BUYSELL Nigeria`;
  }, [normalizedCategory, config.title]);

  useEffect(() => {
    setPage(1);
  }, [normalizedCategory, search, sort]);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      setStatus('loading');
      try {
        const db = await createSupabaseClient();
        if (isUpcoming) {
          const query = db.from('upcoming_products').select(upcomingColumns).eq('status', 'active').order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(120);
          const { data, error } = await query;
          if (error) throw error;
          if (!cancelled) {
            setItems(data || []);
            setStatus('ready');
          }
          return;
        } else {
          const { rows: data, allRows: catalogue } = await fetchCategoryRows(db, normalizedCategory);
          if (!cancelled) setAllRows(catalogue);
          const rows = normalizedCategory === 'trending'
            ? [...(data || [])].sort((a, b) => {
                const bScore = Number(b.review_count || 0) * 3 + Number(b.avg_rating || 0) + (b.has_video ? 2 : 0);
                const aScore = Number(a.review_count || 0) * 3 + Number(a.avg_rating || 0) + (a.has_video ? 2 : 0);
                return bScore - aScore;
              })
            : data || [];
          if (!cancelled) {
            setItems(rows);
            setStatus('ready');
          }
          return;
        }
      } catch (error) {
        console.warn('Category page load failed:', error);
        if (!cancelled) setStatus('error');
      }
    }
    loadProducts();
    return () => { cancelled = true; };
  }, [normalizedCategory, isUpcoming]);

  useEffect(() => {
    if (isUpcoming && (sort === 'price-asc' || sort === 'price-desc')) {
      setSort('newest');
    }
  }, [isUpcoming, sort]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const query = search.trim();
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    if (sort !== 'newest') url.searchParams.set('sort', sort);
    else url.searchParams.delete('sort');
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }, [search, sort, page]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(item => [item.name, item.title, item.description, item.location, item.category, item.profiles?.store_name, item.profiles?.name]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(term)))
      : items;
    return sortItems(filtered, sort, isUpcoming);
  }, [items, search, sort, isUpcoming]);

  const totalPages = Math.ceil(visibleItems.length / ITEMS_PER_PAGE) || 1;
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, visibleItems.length);
  const paginatedItems = useMemo(() => {
    return visibleItems.slice(startIndex, endIndex);
  }, [visibleItems, startIndex, endIndex]);

  // Live counts for the category buttons, from the same catalogue the page loads.
  const counts = useMemo(() => {
    if (!allRows.length) return {};
    const result = {};
    categoryLinks.forEach(([, , key]) => {
      if (key === 'upcoming') return;
      result[key] = allRows.filter(product => matchesCategory(product, key)).length;
    });
    if (isCustomCategory) result[normalizedCategory] = items.length;
    return result;
  }, [allRows, items.length, isCustomCategory, normalizedCategory]);

  // Real figures for the hero: stores, lowest price, products with video.
  const stats = useMemo(() => {
    if (isUpcoming || !items.length) return null;
    const prices = items.map(item => Number(item.price)).filter(price => price > 0);
    return {
      stores: new Set(items.map(item => item.seller_id).filter(Boolean)).size,
      fromPrice: prices.length ? Math.min(...prices) : 0,
      withVideo: items.filter(item => item.video_url || item.has_video || (Array.isArray(item.videos) && item.videos.length)).length,
    };
  }, [items, isUpcoming]);

  // Three recent products with pictures for the hero collage.
  const collage = useMemo(() => {
    if (isUpcoming) return [];
    const hasPicture = item => item.image_url || item.video_url
      || (Array.isArray(item.images) && item.images.length) || (Array.isArray(item.videos) && item.videos.length);
    return items.filter(hasPicture).slice(0, 3).map(item => ({ id: item.id, src: cardImage(item, 520) }));
  }, [items, isUpcoming]);

  const sortOptions = [
    ['newest', 'Newest'],
    ...(!isUpcoming ? [['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low']] : []),
    ['rating', isUpcoming ? 'Priority' : 'Top rated'],
  ];

  return (
    <>
      <BrandHeader className="category-page-header" onOpenCart={() => setIsCartOpen(true)} />
      <main className="category-page-main cx">
        <section className="cx-hero" aria-labelledby="category-title">
          <div className="cx-hero-copy">
            <nav className="cx-crumbs" aria-label="Breadcrumb">
              <a href="/?view=shop">Marketplace</a>
              <i className="fa-solid fa-chevron-right" aria-hidden="true" />
              <a href="/products">Categories</a>
              {normalizedCategory !== 'all' ? (
                <>
                  <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                  <span aria-current="page">{config.title}</span>
                </>
              ) : null}
            </nav>
            <span className="cx-live">
              <span className="cx-live-dot" aria-hidden="true" />
              {status === 'ready'
                ? `${items.length.toLocaleString('en-NG')} ${isUpcoming ? 'upcoming drops' : items.length === 1 ? 'product live' : 'products live'}`
                : isUpcoming ? 'Launch preview' : 'BUYSELL collection'}
            </span>
            <h1 id="category-title">
              <span className="cx-hero-icon" aria-hidden="true"><i className={`fa-solid ${config.icon}`} /></span>
              {config.title}
            </h1>
            <p id="category-subtitle">{config.subtitle}</p>
            {stats ? (
              <dl className="cx-stats">
                <div><dt>Stores</dt><dd>{stats.stores.toLocaleString('en-NG')}</dd></div>
                {stats.fromPrice ? <div><dt>Prices from</dt><dd>{money(stats.fromPrice)}</dd></div> : null}
                {stats.withVideo ? <div><dt>With video</dt><dd>{stats.withVideo.toLocaleString('en-NG')}</dd></div> : null}
              </dl>
            ) : null}
          </div>
          <div className={`cx-collage${collage.length < 3 ? ' cx-collage--photo' : ''}`} aria-hidden="true">
            {collage.length >= 3
              ? collage.map((item, index) => <img key={item.id} className={`cx-collage-${index + 1}`} src={item.src} alt="" decoding="async" />)
              : <img className="cx-collage-photo" src={categoryImages[normalizedCategory] || categoryImages.all} alt="" decoding="async" />}
          </div>
        </section>

        <CategoryNav active={normalizedCategory} customLabel={isCustomCategory ? config.title : ''} counts={counts} />

        <section className="category-toolbar cx-toolbar" aria-label="Browse and filter products">
          <label className="category-search-field">
            <span className="sr-only">Search {config.title}</span>
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input
              className="form-input"
              type="search"
              placeholder={config.searchPlaceholder}
              value={search}
              onChange={event => setSearch(event.target.value)}
              aria-controls="category-products"
            />
            {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><i className="fa-solid fa-xmark" /></button> : null}
          </label>
          <div className="cx-sort" role="group" aria-label="Sort products">
            {sortOptions.map(([value, label]) => (
              <button key={value} type="button" className={sort === value ? 'active' : ''} aria-pressed={sort === value} onClick={() => setSort(value)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <p className="category-results-count cx-results" aria-live="polite">
          {status === 'loading' ? 'Loading products…' : status === 'error' ? '' : visibleItems.length > 0 ? (
            <>
              Showing <strong>{startIndex + 1}–{endIndex}</strong> of <strong>{visibleItems.length.toLocaleString('en-NG')}</strong> {visibleItems.length === 1 ? 'item' : 'items'}
              {search ? <> for <strong>“{search.trim()}”</strong></> : null}
            </>
          ) : (
            <><strong>0</strong> items{search ? <> for <strong>“{search.trim()}”</strong></> : null}</>
          )}
        </p>

        {status === 'loading' ? (
          <div className="category-products-grid" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <div className="cat-product-card cx-skeleton" key={index}>
                <div className="cat-product-media" />
                <div className="cat-product-body"><span /><span /><span /></div>
              </div>
            ))}
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="category-empty">
            <i className="fa-solid fa-triangle-exclamation" />
            <h2>Products could not load</h2>
            <p>Check your connection and try again.</p>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => window.location.reload()}>Try again</button>
          </div>
        ) : null}
        {status === 'ready' && !visibleItems.length ? (
          <div className="category-empty">
            <i className="fa-solid fa-box-open" />
            <h2>No matches found</h2>
            <p>{search ? 'Try a shorter search term, another spelling, or clear the search to browse this category.' : 'No products here yet. Check back soon for new listings.'}</p>
            {search
              ? <button className="btn btn-outline btn-sm" type="button" onClick={() => setSearch('')}>Clear search</button>
              : <a className="btn btn-outline btn-sm" href="/products">Browse all products</a>}
          </div>
        ) : null}
        {status === 'ready' && visibleItems.length ? (
          <>
            <div className="category-products-grid" id="category-products">
              {paginatedItems.map(item => isUpcoming ? <UpcomingProductCard product={item} key={item.id} /> : <CategoryProductCard product={item} key={item.id} />)}
            </div>
            <Pagination
              totalPages={totalPages}
              currentPage={currentPage}
              totalItems={visibleItems.length}
              startIndex={startIndex}
              endIndex={endIndex}
              onPageChange={newPage => {
                setPage(newPage);
                const el = document.getElementById('category-products') || document.querySelector('.category-toolbar');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              itemLabel={isUpcoming ? 'upcoming drops' : 'items'}
            />
          </>
        ) : null}

        <CategoryTrustBar />
      </main>
      <footer className="cx-footer">
        <div>
          <BrandLogo variant="transparent" className="cx-footer-logo" />
          <p>Shop, sell and source across Nigeria with every payment checked by BUYSELL.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="/?view=shop">Marketplace</a>
          <a href="/products">All categories</a>
          <a href="/category/dropship">1688 Sourcing</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
}
