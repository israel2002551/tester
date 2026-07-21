const CATEGORY_PAGE_CONFIG = {
  all: { title: 'All Products', icon: 'fa-border-all', subtitle: 'Browse every active product on BUYSELL Nigeria.' },
  trending: { title: 'Trending Products', icon: 'fa-fire', subtitle: 'Popular products with strong ratings, videos, and fresh activity.' },
  electronics: { title: 'Electronics', icon: 'fa-microchip', subtitle: 'Gadgets, devices, accessories, and smart tech.' },
  phones: { title: 'Phones & Tablets', icon: 'fa-mobile-screen', subtitle: 'Mobile phones, tablets, accessories, and deals.' },
  fashion: { title: 'Fashion', icon: 'fa-shirt', subtitle: 'Clothing, shoes, bags, and everyday style.' },
  home: { title: 'Home & Kitchen', icon: 'fa-house', subtitle: 'Home essentials, kitchen tools, decor, and appliances.' },
  beauty: { title: 'Beauty & Health', icon: 'fa-spa', subtitle: 'Beauty, personal care, wellness, and health products.' },
  sports: { title: 'Sports', icon: 'fa-dumbbell', subtitle: 'Fitness, sports gear, and active lifestyle products.' },
  dropship: { title: 'Dropshipping Products', icon: 'fa-globe', subtitle: 'Global products available for dropship sellers and buyers.' },
};

const CATEGORY_PAGE_LINKS = {
  all: 'products.html',
  trending: 'category-trending.html',
  electronics: 'category-electronics.html',
  phones: 'category-phones.html',
  fashion: 'category-fashion.html',
  home: 'category-home.html',
  beauty: 'category-beauty.html',
  sports: 'category-sports.html',
  dropship: 'category-dropship.html',
};

let categoryProducts = [];
let currentCategory = document.body?.dataset.category || 'all';
let categoryDb = null;

try {
  const categoryParam = new URLSearchParams(window.location.search).get('category');
  if (categoryParam && CATEGORY_PAGE_CONFIG[categoryParam]) currentCategory = categoryParam;
} catch (_) {}

function categoryEsc(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function categoryMoney(value) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function categoryProductImage(product) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  return product.image_url || images[0] || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&h=600&fit=crop';
}

function categoryProductCard(product) {
  const image = categoryProductImage(product);
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  const hasVideo = videos.length || product.video_url || product.has_video;
  const rating = Number(product.avg_rating || 5).toFixed(1);
  const seller = product.profiles?.store_name || product.profiles?.name || 'Seller';
  return `
    <article class="cat-product-card" onclick="location.href='index.html?product=${categoryEsc(product.id)}'">
      <div class="cat-product-media">
        <img src="${categoryEsc(image)}" alt="${categoryEsc(product.name || 'Product')}" loading="lazy">
        <div class="cat-product-badges">
          ${hasVideo ? '<span><i class="fa-solid fa-video"></i> Video</span>' : ''}
          ${product.category === 'dropship' ? '<span>Dropship</span>' : ''}
        </div>
      </div>
      <div class="cat-product-body">
        <h2>${categoryEsc(product.name || 'Product')}</h2>
        <div class="cat-product-price">${categoryMoney(product.price)}</div>
        <div class="cat-product-meta">
          <span><i class="fa-solid fa-star"></i> ${rating}</span>
          <span><i class="fa-solid fa-location-dot"></i> ${categoryEsc(product.location || 'Nigeria')}</span>
        </div>
        <div class="cat-product-store"><i class="fa-solid fa-store"></i> ${categoryEsc(seller)}</div>
      </div>
    </article>`;
}

function renderCategoryProducts(items) {
  const grid = document.getElementById('category-products-grid');
  const empty = document.getElementById('category-empty');
  const count = document.getElementById('category-count');
  if (count) count.textContent = items.length;
  if (!grid || !empty) return;
  if (!items.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = items.map(categoryProductCard).join('');
}

function applyCategorySearch() {
  const term = (document.getElementById('category-search')?.value || '').trim().toLowerCase();
  const sort = document.getElementById('category-sort')?.value || 'newest';
  let items = [...categoryProducts];
  if (term) {
    items = items.filter(product => [
      product.name,
      product.description,
      product.category,
      product.location,
    ].some(value => String(value || '').toLowerCase().includes(term)));
  }
  if (sort === 'price-asc') items.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  if (sort === 'price-desc') items.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  if (sort === 'rating') items.sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0));
  renderCategoryProducts(items);
}

async function loadCategoryPageProducts() {
  const skeleton = document.getElementById('category-skeleton');
  const error = document.getElementById('category-error');
  const grid = document.getElementById('category-products-grid');
  skeleton?.classList.remove('hidden');
  error?.classList.add('hidden');
  grid.innerHTML = '';
  try {
    let query = categoryDb
      .from('products')
      .select('*, profiles(name, store_name, role, email)')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (!['all', 'trending'].includes(currentCategory)) query = query.eq('category', currentCategory);
    const { data, error: queryError } = await query;
    if (queryError) throw queryError;
    categoryProducts = data || [];
    if (currentCategory === 'trending') {
      categoryProducts.sort((a, b) => {
        const bScore = Number(b.review_count || 0) * 3 + Number(b.avg_rating || 0) + (b.has_video ? 2 : 0);
        const aScore = Number(a.review_count || 0) * 3 + Number(a.avg_rating || 0) + (a.has_video ? 2 : 0);
        return bScore - aScore;
      });
    }
    skeleton?.classList.add('hidden');
    applyCategorySearch();
  } catch (err) {
    skeleton?.classList.add('hidden');
    error?.classList.remove('hidden');
    console.warn('Category page load failed:', err);
  }
}

function initCategoryPage() {
  const config = CATEGORY_PAGE_CONFIG[currentCategory] || CATEGORY_PAGE_CONFIG.all;
  document.title = `${config.title} - BUYSELL Nigeria`;
  document.getElementById('category-title').textContent = config.title;
  document.getElementById('category-subtitle').textContent = config.subtitle;
  document.getElementById('category-icon').className = `fa-solid ${config.icon}`;
  document.querySelectorAll('[data-category-nav]').forEach(link => {
    link.classList.toggle('active', link.dataset.categoryNav === currentCategory);
  });
  if (!window.supabase || typeof SB_URL === 'undefined' || typeof SB_KEY === 'undefined') {
    document.getElementById('category-error')?.classList.remove('hidden');
    return;
  }
  categoryDb = window.supabase.createClient(SB_URL, SB_KEY);
  loadCategoryPageProducts();
}

document.addEventListener('DOMContentLoaded', initCategoryPage);
