import { useEffect, useMemo, useState } from 'react';
import BrandHeader from '../components/BrandHeader.jsx';
import CategoryNav from '../components/CategoryNav.jsx';
import CategoryTrustBar from '../components/CategoryTrustBar.jsx';
import LoadingGrid from '../components/LoadingGrid.jsx';
import { CategoryProductCard, UpcomingProductCard } from '../components/CategoryProductCard.jsx';
import { createSupabaseClient } from '../lib/browserConfig.js';
import { categoryConfig, categoryProductColumns, upcomingColumns } from '../lib/categoryData.js';

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

export default function CategoryPage({ category = 'all' }) {
  const config = categoryConfig[category] || categoryConfig.all;
  const isUpcoming = category === 'upcoming';
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    document.body.className = 'category-page';
    document.body.dataset.category = category;
    document.title = `${config.title} - BUYSELL Nigeria`;
  }, [category, config.title]);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      setStatus('loading');
      try {
        const db = await createSupabaseClient();
        let query;
        if (isUpcoming) {
          query = db.from('upcoming_products').select(upcomingColumns).eq('status', 'active').order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(120);
        } else {
          query = db.from('products').select(categoryProductColumns).eq('status', 'approved').order('created_at', { ascending: false }).limit(120);
          if (category !== 'all' && category !== 'trending') query = query.eq('category', category);
        }
        const { data, error } = await query;
        if (error) throw error;
        const rows = category === 'trending'
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
      } catch (error) {
        console.warn('Category page load failed:', error);
        if (!cancelled) setStatus('error');
      }
    }
    loadProducts();
    return () => { cancelled = true; };
  }, [category, isUpcoming]);

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
      <BrandHeader className="category-page-header" />
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
        <CategoryNav active={category} />
        <section className="category-toolbar">
          <input className="form-input" placeholder={config.searchPlaceholder} value={search} onChange={event => setSearch(event.target.value)} />
          <select className="form-select" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">Newest</option>
            {!isUpcoming ? <option value="price-asc">Price low to high</option> : null}
            {!isUpcoming ? <option value="price-desc">Price high to low</option> : null}
            <option value="rating">{isUpcoming ? 'Priority' : 'Top rated'}</option>
          </select>
          <span><strong>{visibleItems.length}</strong> items</span>
        </section>
        {status === 'loading' ? <LoadingGrid /> : null}
        {status === 'error' ? <div className="category-empty"><i className="fa-solid fa-triangle-exclamation" /><p>Could not load products. Please try again.</p></div> : null}
        {status === 'ready' && !visibleItems.length ? <div className="category-empty"><i className="fa-solid fa-box-open" /><p>No products found here yet.</p></div> : null}
        {status === 'ready' && visibleItems.length ? (
          <div className="category-products-grid">
            {visibleItems.map(item => isUpcoming ? <UpcomingProductCard product={item} key={item.id} /> : <CategoryProductCard product={item} key={item.id} />)}
          </div>
        ) : null}
      </main>
    </>
  );
}
