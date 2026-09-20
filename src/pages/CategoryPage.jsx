import { useEffect, useMemo, useState } from 'react';
import BrandHeader from '../components/BrandHeader.jsx';
import CategoryNav from '../components/CategoryNav.jsx';
import CategoryTrustBar from '../components/CategoryTrustBar.jsx';
import LoadingGrid from '../components/LoadingGrid.jsx';
import CartDrawer from '../components/CartDrawer.jsx';
import { CategoryProductCard, UpcomingProductCard } from '../components/CategoryProductCard.jsx';
import { createSupabaseClient } from '../lib/browserConfig.js';
import { categoryConfig, categoryProductColumns, upcomingColumns } from '../lib/categoryData.js';

const categoryColumnFallbacks = [
  categoryProductColumns,
  'id,seller_id,name,description,price,original_price,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,avg_rating,review_count',
  'id,seller_id,name,description,price,category,condition,location,image_url,status,created_at',
];

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

async function fetchCategoryRows(db, category) {
  let lastError = null;
  for (const columns of categoryColumnFallbacks) {
    for (const status of ['active', 'approved']) {
      let query = db.from('products').select(columns).eq('status', status).order('created_at', { ascending: false }).limit(160);
      const { data, error } = await query;
      if (error) {
        lastError = error;
        continue;
      }
      const rows = (data || []).filter(product => matchesCategory(product, category));
      if (rows.length || category === 'all' || category === 'trending') return rows;
    }
  }
  if (lastError) throw lastError;
  return [];
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
  const [status, setStatus] = useState('loading');
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    document.body.className = 'category-page';
    document.body.dataset.category = normalizedCategory;
    document.title = `${config.title} - BUYSELL Nigeria`;
  }, [normalizedCategory, config.title]);

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
          const data = await fetchCategoryRows(db, normalizedCategory);
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
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }, [search, sort]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(item => [item.name, item.title, item.description, item.location, item.category, item.profiles?.store_name, item.profiles?.name]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(term)))
      : items;
    return sortItems(filtered, sort, isUpcoming);
  }, [items, search, sort, isUpcoming]);

  return (
    <>
      <BrandHeader className="category-page-header" onOpenCart={() => setIsCartOpen(true)} />
      <main className="category-page-main">
        <section className="category-hero">
          <span className="category-hero-kicker">{isUpcoming ? 'Launch Preview' : 'BUYSELL Collection'}</span>
          <div className="category-hero-icon"><i className={`fa-solid ${config.icon}`} /></div>
          <div>
            <h1 id="category-title">{config.title}</h1>
            <p id="category-subtitle">{config.subtitle}</p>
          </div>
        </section>
        <CategoryTrustBar />
        <CategoryNav active={normalizedCategory} customLabel={isCustomCategory ? config.title : ''} />
        <section className="category-toolbar" aria-label="Browse and filter products">
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
          <label className="category-sort-field">
            <span>Sort</span>
            <select className="form-select" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">Newest</option>
            {!isUpcoming ? <option value="price-asc">Price low to high</option> : null}
            {!isUpcoming ? <option value="price-desc">Price high to low</option> : null}
            <option value="rating">{isUpcoming ? 'Priority' : 'Top rated'}</option>
            </select>
          </label>
          <span className="category-results-count" aria-live="polite"><strong>{visibleItems.length}</strong> {visibleItems.length === 1 ? 'item' : 'items'}{search ? ` for "${search.trim()}"` : ''}</span>
        </section>
        {status === 'loading' ? <LoadingGrid /> : null}
        {status === 'error' ? <div className="category-empty"><i className="fa-solid fa-triangle-exclamation" /><p>Could not load products. Please try again.</p></div> : null}
        {status === 'ready' && !visibleItems.length ? <div className="category-empty"><i className="fa-solid fa-box-open" /><h2>No matches found</h2><p>{search ? 'Try a shorter search term, another spelling, or clear the search to browse this category.' : 'No products found here yet. Check back soon for new listings.'}</p>{search ? <button className="btn btn-outline btn-sm" type="button" onClick={() => setSearch('')}>Clear search</button> : null}</div> : null}
        {status === 'ready' && visibleItems.length ? (
          <div className="category-products-grid" id="category-products">
            {visibleItems.map(item => isUpcoming ? <UpcomingProductCard product={item} key={item.id} /> : <CategoryProductCard product={item} key={item.id} />)}
          </div>
        ) : null}
      </main>
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
}
