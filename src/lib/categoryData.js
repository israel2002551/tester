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

export const categoryProductColumns = 'id,seller_id,name,description,price,original_price,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,avg_rating,review_count,profiles(name,store_name,role,email)';
export const upcomingColumns = 'id,title,description,image_url,video_url,images,videos,launch_date,priority,status,created_at';

export function productImage(product = {}) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  return product.image_url || images[0] || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&h=600&fit=crop';
}

export function upcomingMedia(product = {}) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  return {
    images: product.image_url ? [product.image_url, ...images.filter(url => url !== product.image_url)] : images,
    videos: product.video_url ? [product.video_url, ...videos.filter(url => url !== product.video_url)] : videos,
  };
}
