export const productColumns = 'id,seller_id,name,description,price,original_price,shipping_fee,shipping_cost,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,avg_rating,review_count,negotiable,profiles(id,name,email,role,accounts,store_name,store_description,whatsapp,logo_url,store_address,seller_verified,kyc_status)';

export function productMedia(product = {}) {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  const media = [
    ...(product.video_url ? [product.video_url, ...videos.filter(url => url !== product.video_url)] : videos).map(url => ({ type: 'video', url })),
    ...(product.image_url ? [product.image_url, ...images.filter(url => url !== product.image_url)] : images).map(url => ({ type: 'image', url })),
  ];
  return media.length ? media : [{ type: 'image', url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=900&h=900&fit=crop&q=82' }];
}

export function shippingFee(product = {}) {
  return Math.max(0, Number(product.shipping_fee ?? product.shipping_cost ?? product.shipping ?? 0) || 0);
}

// Cloudinary rejects image transforms (f_auto, g_auto) on /video/upload/, so videos get a first-frame JPG poster.
export function cloudinaryImage(url, width, { square = false } = {}) {
  const source = String(url || '');
  if (!source.includes('res.cloudinary.com/') || !source.includes('/upload/')) return source;
  if (source.includes('/video/upload/')) {
    const crop = square ? `c_fill,w_${width},h_${width}` : `c_limit,w_${width}`;
    return source
      .replace('/video/upload/', `/video/upload/so_0,q_auto,${crop}/`)
      .replace(/\.(mp4|mov|webm|m4v|avi|mkv)(\?.*)?$/i, '.jpg');
  }
  const crop = square ? `c_fill,g_auto,w_${width},h_${width}` : `c_limit,w_${width}`;
  return source.replace('/upload/', `/upload/f_auto,q_auto:good,dpr_auto,${crop}/`);
}

export function categoryLabel(category, fallback) {
  const text = String(category || '').trim();
  if (!text) return fallback;
  return text.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
