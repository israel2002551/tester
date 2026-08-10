import { money, dateLabel } from '../lib/format.js';
import { productImage, upcomingMedia } from '../lib/categoryData.js';
import { readJson, writeJson } from '../lib/storage.js';

export function CategoryProductCard({ product }) {
  const image = productImage(product);
  const videos = Array.isArray(product.videos) ? product.videos.filter(Boolean) : [];
  const hasVideo = videos.length || product.video_url || product.has_video;
  const rating = Number(product.avg_rating || 5).toFixed(1);
  const seller = product.profiles?.store_name || product.profiles?.name || 'Seller';

  return (
    <article className="cat-product-card" onClick={() => { window.location.href = `/product.html?id=${encodeURIComponent(product.id)}`; }}>
      <div className="cat-product-media">
        <img src={image} alt={product.name || 'Product'} loading="lazy" />
        <div className="cat-product-badges">
          {hasVideo ? <span><i className="fa-solid fa-video" /> Video</span> : null}
          {product.category === 'dropship' ? <span>Dropship</span> : null}
        </div>
      </div>
      <div className="cat-product-body">
        <h2>{product.name || 'Product'}</h2>
        <div className="cat-product-price">{money(product.price)}</div>
        <div className="cat-product-meta">
          <span><i className="fa-solid fa-star" /> {rating}</span>
          <span>{product.location || 'Nigeria'}</span>
        </div>
        <p>{seller}</p>
      </div>
    </article>
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
