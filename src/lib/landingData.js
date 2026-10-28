import { useEffect, useState } from 'react';
import { createSupabaseClient } from './browserConfig.js';
import { cloudinaryImage } from './productData.js';

export const landingCategories = [
  { key: 'fashion', name: 'Fashion', icon: 'fa-shirt', href: '/category/fashion' },
  { key: 'phones', name: 'Phones', icon: 'fa-mobile-screen-button', href: '/category/phones' },
  { key: 'home', name: 'Home & living', icon: 'fa-couch', href: '/category/home' },
  { key: 'beauty', name: 'Beauty', icon: 'fa-wand-magic-sparkles', href: '/category/beauty' },
  { key: 'electronics', name: 'Electronics', icon: 'fa-headphones', href: '/category/electronics' },
];

const listColumns = 'id,name,price,original_price,category,images,image_url,video_url,videos,stock_quantity,created_at';
const coverColumns = 'id,images,image_url,video_url,videos';

/** Best still image for a product: a photo, else a Cloudinary video poster. */
export function landingImage(product = {}, width = 480) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const photo = product.image_url || images[0];
  if (photo) return cloudinaryImage(photo, width, { square: true });
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  const video = product.video_url || videos[0] || '';
  return video.includes('res.cloudinary.com/') ? cloudinaryImage(video, width, { square: true }) : '';
}

export function naira(value) {
  return `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
}

/**
 * Live catalogue for the landing page: newest products, the active product
 * count, and a count plus cover image per category. Failures leave the page
 * usable; sections that need data simply fall back.
 */
export function useLandingCatalog() {
  const [state, setState] = useState({ status: 'loading', products: [], total: null, categories: {} });

  useEffect(() => {
    let cancelled = false;
    // The client retries failed requests for ~10s; show the fallback sooner
    // and still swap in live data if it arrives later.
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) setState(current => (current.status === 'loading' ? { ...current, status: 'error' } : current));
    }, 6000);
    (async () => {
      try {
        const db = await createSupabaseClient();
        const active = (columns, options) => db.from('products').select(columns, options).eq('status', 'active');
        const [latest, total, ...perCategory] = await Promise.all([
          active(listColumns).order('created_at', { ascending: false }).limit(40),
          active('id', { count: 'exact', head: true }),
          ...landingCategories.map(category => active(coverColumns, { count: 'exact' })
            .eq('category', category.key)
            .order('created_at', { ascending: false })
            .limit(6)),
        ]);
        if (latest.error) throw latest.error;
        const products = (latest.data || [])
          .filter(product => Number(product.stock_quantity) !== 0 && Number(product.price) > 0)
          .map(product => ({ ...product, image: landingImage(product) }))
          .filter(product => product.image);
        const categories = {};
        landingCategories.forEach((category, index) => {
          const result = perCategory[index];
          if (result?.error) return;
          const cover = (result.data || []).map(row => landingImage(row, 720)).find(Boolean) || '';
          categories[category.key] = { count: result.count ?? null, cover };
        });
        if (!cancelled) setState({ status: 'ready', products, total: total.error ? null : total.count, categories });
      } catch (error) {
        console.warn('Landing catalogue unavailable:', error);
        if (!cancelled) setState(current => ({ ...current, status: 'error' }));
      }
    })();
    return () => { cancelled = true; clearTimeout(fallbackTimer); };
  }, []);

  return state;
}
