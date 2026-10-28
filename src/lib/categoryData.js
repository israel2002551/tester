import { cloudinaryImage } from './productData.js';

export const categoryConfig = {
  all: {
    title: 'All Products',
    subtitle: 'Browse every active product on BUYSELL Nigeria.',
    icon: 'fa-border-all',
    searchPlaceholder: 'Search this category...',
  },
  trending: {
    title: 'Trending Products',
    subtitle: 'Popular products with strong ratings, videos, and fresh activity.',
    icon: 'fa-fire',
    searchPlaceholder: 'Search trending products...',
  },
  phones: {
    title: 'Phones & Gadgets',
    subtitle: 'Smartphones, accessories, and mobile deals from Nigerian sellers.',
    icon: 'fa-mobile-screen-button',
    searchPlaceholder: 'Search phones and gadgets...',
  },
  fashion: {
    title: 'Fashion',
    subtitle: 'Clothing, shoes, watches, bags, and style pieces.',
    icon: 'fa-shirt',
    searchPlaceholder: 'Search fashion products...',
  },
  home: {
    title: 'Home & Living',
    subtitle: 'Furniture, appliances, decor, and everyday home essentials.',
    icon: 'fa-couch',
    searchPlaceholder: 'Search home products...',
  },
  electronics: {
    title: 'Electronics',
    subtitle: 'TVs, laptops, audio, power products, and smart devices.',
    icon: 'fa-tv',
    searchPlaceholder: 'Search electronics...',
  },
  beauty: {
    title: 'Beauty & Care',
    subtitle: 'Skincare, fragrance, cosmetics, and personal care products.',
    icon: 'fa-spa',
    searchPlaceholder: 'Search beauty products...',
  },
  sports: {
    title: 'Sports & Fitness',
    subtitle: 'Training gear, activewear, equipment, and outdoor picks.',
    icon: 'fa-dumbbell',
    searchPlaceholder: 'Search sports products...',
  },
  dropship: {
    title: '1688 & Dropship Deals',
    subtitle: 'Sourcing-ready products for bulk orders and resellers.',
    icon: 'fa-boxes-stacked',
    searchPlaceholder: 'Search dropship products...',
  },
  upcoming: {
    title: 'Upcoming Products',
    subtitle: 'Preview products and launches coming soon to BUYSELL.',
    icon: 'fa-calendar-plus',
    searchPlaceholder: 'Search upcoming products...',
  },
};

export const categoryLinks = [
  ['All', '/products', 'all'],
  ['Trending', '/category/trending', 'trending'],
  ['Phones', '/category/phones', 'phones'],
  ['Fashion', '/category/fashion', 'fashion'],
  ['Home', '/category/home', 'home'],
  ['Electronics', '/category/electronics', 'electronics'],
  ['Beauty', '/category/beauty', 'beauty'],
  ['Sports', '/category/sports', 'sports'],
  ['Dropship', '/category/dropship', 'dropship'],
  ['Upcoming', '/upcoming', 'upcoming'],
];

// Shown in the hero only when a category has no products to display yet.
export const categoryImages = {
  all: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&h=900&fit=crop&q=80',
  trending: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&h=900&fit=crop&q=80',
  phones: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&h=900&fit=crop&q=80',
  fashion: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&h=900&fit=crop&q=80',
  home: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200&h=900&fit=crop&q=80',
  electronics: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=1200&h=900&fit=crop&q=80',
  beauty: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&h=900&fit=crop&q=80',
  sports: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1200&h=900&fit=crop&q=80',
  dropship: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1200&h=900&fit=crop&q=80',
  upcoming: 'https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=1200&h=900&fit=crop&q=80',
};

export function categoryIcon(key) {
  return categoryConfig[key]?.icon || 'fa-tags';
}

export const categoryProductColumns = 'id,seller_id,name,description,price,original_price,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,avg_rating,review_count,profiles(name,store_name,role)';
export const upcomingColumns = 'id,title,description,image_url,video_url,images,videos,launch_date,priority,status,created_at';

export function productImage(product = {}) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  return product.image_url || images[0] || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&h=600&fit=crop';
}

/** Card picture: a photo, else a still from the product's video, else a placeholder. */
export function cardImage(product = {}, width = 480) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  const posterVideo = !product.image_url && !images.length ? product.video_url || videos[0] : '';
  return cloudinaryImage(posterVideo || productImage(product), width, { square: true });
}

export function upcomingMedia(product = {}) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  return {
    images: product.image_url ? [product.image_url, ...images.filter(url => url !== product.image_url)] : images,
    videos: product.video_url ? [product.video_url, ...videos.filter(url => url !== product.video_url)] : videos,
  };
}
