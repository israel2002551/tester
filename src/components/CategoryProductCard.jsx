import { money, dateLabel } from '../lib/format.js';
import { cardImage, upcomingMedia } from '../lib/categoryData.js';
import { readJson, writeJson } from '../lib/storage.js';

export function CategoryProductCard({ product }) {
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  const hasVideo = videos.length || product.video_url || product.has_video;
  const image = cardImage(product, 480);
  const price = Number(product.price || 0);
  const original = Number(product.original_price || 0);
  const discount = original > price && price > 0 ? Math.round((1 - price / original) * 100) : 0;
  // Show a rating only once a product has reviews.
  const reviewCount = Number(product.review_count || 0);
  const rating = reviewCount > 0 ? Number(product.avg_rating || 0).toFixed(1) : '';
  const stock = product.stock_quantity;
  const stockLabel = stock === 0 ? 'Sold out' : Number(stock) > 0 && Number(stock) <= 5 ? `Only ${stock} left` : '';
  const seller = product.profiles?.store_name || product.profiles?.name || 'Seller';
  const productHref = product.id ? `/product.html?id=${encodeURIComponent(product.id)}` : '/products';

  return (
    <a className="cat-product-card" href={productHref} aria-label={`View ${product.name || 'product'}`}>
      <div className="cat-product-media">
        <img src={image} alt={product.name || 'Product'} loading="lazy" decoding="async" />
        <div className="cat-product-badges">
          {discount >= 5 ? <span className="is-deal">-{discount}%</span> : null}
          {hasVideo ? <span><i className="fa-solid fa-video" /> Video</span> : null}
          {product.category === 'dropship' ? <span>Dropship</span> : null}
        </div>
        <span className="cat-product-view" aria-hidden="true"><i className="fa-solid fa-arrow-right" /></span>
      </div>
      <div className="cat-product-body">
        <h2>{product.name || 'Product'}</h2>
        <div className="cat-product-price">
          {money(product.price)}
          {discount >= 5 ? <s>{money(original)}</s> : null}
        </div>
        <div className="cat-product-meta">
          {rating
            ? <span className="cat-product-rating"><i className="fa-solid fa-star" /> {rating} ({reviewCount})</span>
            : <span className="cat-product-new"><i className="fa-solid fa-seedling" /> New listing</span>}
          {stockLabel ? <span className="cat-product-stock">{stockLabel}</span> : null}
        </div>
        <p className="cat-product-seller">
          <i className="fa-solid fa-store" /> <span>{seller}</span>
          <em><i className="fa-solid fa-location-dot" /> {product.location || 'Nigeria'}</em>
        </p>
      </div>
    </a>
  );
}

export function UpcomingProductCard({ product }) {
  const { images, videos } = upcomingMedia(product);
  const cover = videos[0] || images[0] || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&h=600&fit=crop';
  const isVideo = Boolean(videos[0]);

  function saveInterest(event) {
    event.stopPropagation();
    const saved = readJson('bs_upcoming_interest', []);
    if (!saved.some(item => item.id === product.id)) {
      writeJson('bs_upcoming_interest', [
        ...saved,
        { id: product.id, title: product.title || 'Upcoming product', saved_at: new Date().toISOString() },
      ]);
    }
  }

  return (
    <article className="cat-product-card upcoming-listing-card">
      <div className="cat-product-media">
        {isVideo ? (
          <video src={cover} controls playsInline preload="metadata" />
        ) : (
          <img src={cover} alt={product.title || 'Upcoming product'} loading="lazy" />
        )}
        <div className="cat-product-badges">
          <span>Launch</span>
          {isVideo ? <span><i className="fa-solid fa-video" /> Video</span> : null}
        </div>
      </div>
      <div className="cat-product-body">
        <h2>{product.title || 'Upcoming product'}</h2>
        <div className="cat-product-price">{dateLabel(product.launch_date)}</div>
        <p>{product.description || 'New BUYSELL listing coming soon.'}</p>
        <button className="btn btn-outline btn-sm" type="button" onClick={saveInterest}>
          <i className="fa-solid fa-bell" /> Notify Me
        </button>
      </div>
    </article>
  );
}
