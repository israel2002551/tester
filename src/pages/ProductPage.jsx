import { useEffect, useMemo, useRef, useState } from 'react';
import LoadingGrid from '../components/LoadingGrid.jsx';
import CartDrawer from '../components/CartDrawer.jsx';
import BrandLogo from '../components/BrandLogo.jsx';
import { createSupabaseClient } from '../lib/browserConfig.js';
import { money } from '../lib/format.js';
import { productColumns, productMedia, shippingFee } from '../lib/productData.js';
import { readJson, writeJson } from '../lib/storage.js';

const productColumnFallbacks = [
  productColumns,
  'id,seller_id,name,description,price,original_price,shipping_fee,shipping_cost,category,condition,location,images,videos,image_url,video_url,has_video,stock_quantity,status,created_at,avg_rating,review_count,negotiable',
  'id,seller_id,name,description,price,original_price,category,condition,location,images,image_url,stock_quantity,status,created_at,avg_rating,review_count',
  'id,seller_id,name,description,price,category,condition,location,image_url,status,created_at',
];

const profileColumnFallbacks = [
  'id,name,email,role,accounts,store_name,store_description,whatsapp,logo_url,store_address,seller_verified,kyc_status',
  'id,name,email,role,store_name,store_description,whatsapp,logo_url,store_address,seller_verified',
  'id,name,email,role,store_name',
];

function cartCount() {
  return readJson('bs_cart', []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
}

function isConfigError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('invalid api key') || message.includes('supabase config unavailable') || message.includes('jwt');
}

function cloudinaryImage(url, width, { square = false } = {}) {
  const source = String(url || '');
  if (!source.includes('res.cloudinary.com/') || !source.includes('/upload/')) return source;
  const crop = square ? `c_fill,g_auto,w_${width},h_${width}` : `c_limit,w_${width}`;
  return source.replace('/upload/', `/upload/f_auto,q_auto:good,dpr_auto,${crop}/`);
}

function cloudinarySrcSet(url, widths = [640, 960, 1280]) {
  const source = String(url || '');
  if (!source.includes('res.cloudinary.com/') || !source.includes('/upload/')) return undefined;
  return widths.map(width => `${cloudinaryImage(source, width)} ${width}w`).join(', ');
}

async function fetchSellerProfile(db, sellerId) {
  if (!sellerId) return null;
  for (const columns of profileColumnFallbacks) {
    const { data, error } = await db.from('profiles').select(columns).eq('id', sellerId).maybeSingle();
    if (!error) return data || null;
  }
  return null;
}

async function fetchProductById(db, productId) {
  let lastError = null;
  for (const columns of productColumnFallbacks) {
    const { data, error } = await db.from('products').select(columns).eq('id', productId).maybeSingle();
    if (error) {
      lastError = error;
      continue;
    }
    if (!data) return null;
    if (!data.profiles && data.seller_id) {
      data.profiles = await fetchSellerProfile(db, data.seller_id);
    }
    return data;
  }
  throw lastError || new Error('Product lookup failed');
}

function visibleGalleryDots(total, activeIndex, maxDots = 7) {
  if (total <= maxDots) return Array.from({ length: total }, (_, index) => index);
  const start = Math.max(0, Math.min(activeIndex - Math.floor(maxDots / 2), total - maxDots));
  return Array.from({ length: maxDots }, (_, offset) => start + offset);
}

export default function ProductPage() {
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState('loading');
  const [activeMedia, setActiveMedia] = useState(0);
  const [count, setCount] = useState(cartCount());
  const [toast, setToast] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const productId = new URLSearchParams(window.location.search).get('id') || new URLSearchParams(window.location.search).get('product');

  const sliderRef = useRef(null);
  const thumbsRef = useRef(null);
  const sliderFrameRef = useRef(0);

  useEffect(() => {
    document.body.classList.add('product-page');
    return () => document.body.classList.remove('product-page');
  }, []);

  useEffect(() => () => {
    if (sliderFrameRef.current) window.cancelAnimationFrame(sliderFrameRef.current);
  }, []);

  useEffect(() => {
    setActiveMedia(0);
    sliderRef.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    async function loadProduct() {
      if (!productId) {
        setStatus('missing');
        return;
      }
      try {
        const db = await createSupabaseClient();
        const data = await fetchProductById(db, productId);
        if (!data) {
          setStatus('missing');
          return;
        }
        if (!cancelled) {
          setProduct(data);
          document.title = `${data.name || 'Product'} - BUYSELL Nigeria`;
          setStatus('ready');
        }
      } catch (error) {
        console.warn('Product page load failed:', error);
        if (!cancelled) setStatus(isConfigError(error) ? 'config-error' : 'error');
      }
    }
    loadProduct();
    return () => { cancelled = true; };
  }, [productId]);

  const media = useMemo(() => productMedia(product || {}), [product]);
  const seller = product?.profiles || {};
  const sellerName = seller.store_name || seller.name || 'BUYSELL Seller';
  const stock = Number(product?.stock_quantity ?? 1);
  const inStock = stock !== 0;
  const discount = product?.original_price > product?.price ? Math.round((1 - product.price / product.original_price) * 100) : 0;
  const galleryDots = useMemo(() => visibleGalleryDots(media.length, activeMedia), [media.length, activeMedia]);

  const handleSliderScroll = () => {
    if (!sliderRef.current || sliderFrameRef.current) return;
    sliderFrameRef.current = window.requestAnimationFrame(() => {
      const slider = sliderRef.current;
      sliderFrameRef.current = 0;
      if (!slider) return;
      const index = Math.round(slider.scrollLeft / (slider.offsetWidth || 1));
      if (index >= 0 && index < media.length) setActiveMedia(previous => previous === index ? previous : index);
    });
  };

  const scrollToSlide = (index) => {
    const target = Math.max(0, Math.min(index, media.length - 1));
    setActiveMedia(target);
    if (sliderRef.current) {
      const width = sliderRef.current.offsetWidth;
      sliderRef.current.scrollTo({ left: target * width, behavior: 'smooth' });
    }
    if (thumbsRef.current) {
      const thumbBtn = thumbsRef.current.children[target];
      if (thumbBtn?.scrollIntoView) {
        thumbBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  };

  function addToCart(quantity = 1) {
    if (!product?.id) return;
    const cart = readJson('bs_cart', []);
    const image = media.find(item => item.type === 'image')?.url || product.image_url || '';
    const item = {
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      original_price: product.original_price,
      shipping_fee: shippingFee(product),
      shipping_cost: shippingFee(product),
      image_url: image,
      seller_id: product.seller_id,
      profiles: seller,
    };
    const existing = cart.find(entry => entry.id === product.id);
    if (existing) existing.qty = (Number(existing.qty) || 1) + quantity;
    else cart.push({ ...item, qty: quantity });
    writeJson('bs_cart', cart);
    window.dispatchEvent(new Event('bs:cart-change'));
    setCount(cartCount());
    setToast('Added to cart');
    window.clearTimeout(addToCart.timer);
    addToCart.timer = window.setTimeout(() => setToast(''), 2200);
  }

  function buyNow() {
    addToCart(1);
    setIsCartOpen(true);
  }

  async function shareProduct() {
    const text = `Check out "${product.name}" for ${money(product.price)} on BUYSELL Nigeria.`;
    const imageUrl = media.find(item => item.type === 'image')?.url || product.image_url || '';
    const shareData = { title: product.name, text, url: window.location.href };
    let imageFile = null;
    if (navigator.share && imageUrl && typeof File !== 'undefined') {
      try {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const imageBlob = await response.blob();
          imageFile = new File([imageBlob], 'buysell-product.jpg', { type: imageBlob.type || 'image/jpeg' });
        }
      } catch (error) {
        console.warn('Product share image could not be attached:', error);
      }
    }
    try {
      if (imageFile && (!navigator.canShare || navigator.canShare({ files: [imageFile] }))) {
        await navigator.share({ ...shareData, files: [imageFile] });
        return;
      }
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard?.writeText(`${window.location.href}\n${text}`);
      setToast('Product link copied');
    } catch (error) {
      if (error?.name !== 'AbortError') setToast('Could not open sharing');
    }
  }

  const handleBack = () => {
    let canReturnToMarketplace = false;
    try {
      const previousUrl = new URL(document.referrer);
      canReturnToMarketplace = previousUrl.origin === window.location.origin
        && !/[?&](entry|mode)=/.test(previousUrl.search);
    } catch (_) {
      canReturnToMarketplace = false;
    }
    const isInAppProductRoute = Boolean(window.history.state?.buysellRoute);
    if (window.history.length > 1 && (isInAppProductRoute || canReturnToMarketplace)) {
      window.history.back();
    } else {
      if (typeof window.bsNavigate === 'function') {
        window.bsNavigate('/?view=shop');
      } else {
        window.location.href = '/?view=shop';
      }
    }
  };

  if (status === 'loading') {
    return (
      <>
        <ProductHeader count={count} onOpenCart={() => setIsCartOpen(true)} onBack={handleBack} />
        <main className="product-page-shell"><LoadingGrid count={2} className="product-page-loading" height={520} /></main>
      </>
    );
  }

  if (status !== 'ready') {
    const isConfigIssue = status === 'config-error';
    const message = status === 'missing' ? 'Product not found.' : isConfigIssue ? 'Marketplace config needs attention.' : 'Could not load product.';
    const detail = isConfigIssue
      ? 'The public Supabase key on this deployment is invalid, so products cannot be loaded yet.'
      : 'This listing may have been removed or is temporarily unavailable.';
    return (
      <>
        <ProductHeader count={count} onOpenCart={() => setIsCartOpen(true)} onBack={handleBack} />
        <main className="product-page-shell">
          <section className="product-page-error">
            <i className="fa-solid fa-box-open" />
            <h1>{message}</h1>
            <p>{detail}</p>
            <div className="product-page-error-actions">
              <button className="btn btn-primary" onClick={handleBack} type="button">
                <i className="fa-solid fa-arrow-left" /> Back to Previous
              </button>
              <a className="btn btn-outline" href="/?view=shop">Marketplace</a>
              <a className="btn btn-outline" href="/products">Browse Products</a>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <ProductHeader count={count} onOpenCart={() => setIsCartOpen(true)} onBack={handleBack} />
      <main className="product-page-shell">
        <section className="product-detail-hero">
          <div className="product-detail-gallery">
            <div className="product-gallery-container">
              <div 
                className="product-gallery-slider" 
                ref={sliderRef}
                onScroll={handleSliderScroll}
              >
                {media.map((item, index) => (
                  <div className="product-gallery-slide" key={`${item.type}-${item.url}-${index}`}>
                    {item.type === 'video' ? (
                      <div className="product-video-wrapper">
                        <video src={item.url} controls playsInline preload="metadata" />
                      </div>
                    ) : (
                      <img 
                        src={cloudinaryImage(item.url, 1280) || item.url} 
                        srcSet={cloudinarySrcSet(item.url)} 
                        sizes="(max-width: 640px) 100vw, 55vw" 
                        alt={`${product.name || 'Product'} - media ${index + 1}`} 
                        loading={index === 0 ? 'eager' : 'lazy'}
                        decoding="async" 
                        fetchPriority={index === 0 ? 'high' : 'auto'} 
                      />
                    )}
                  </div>
                ))}
              </div>

              {media.length > 1 ? (
                <>
                  <div className="product-gallery-counter">
                    {media[activeMedia]?.type === 'video' ? <i className="fa-solid fa-circle-play" /> : <i className="fa-regular fa-image" />}
                    <span>{activeMedia + 1} / {media.length}</span>
                  </div>
                  <button 
                    type="button" 
                    className="product-gallery-arrow prev" 
                    onClick={() => scrollToSlide(activeMedia - 1)}
                    disabled={activeMedia === 0}
                    aria-label="Previous media"
                  >
                    <i className="fa-solid fa-chevron-left" />
                  </button>
                  <button 
                    type="button" 
                    className="product-gallery-arrow next" 
                    onClick={() => scrollToSlide(activeMedia + 1)}
                    disabled={activeMedia === media.length - 1}
                    aria-label="Next media"
                  >
                    <i className="fa-solid fa-chevron-right" />
                  </button>
                  <div className="product-gallery-dots" aria-label="Product media navigation">
                    {galleryDots.map(i => (
                      <button 
                        key={i} 
                        type="button" 
                        className={`product-gallery-dot ${i === activeMedia ? 'active' : ''}`}
                        onClick={() => scrollToSlide(i)}
                        aria-label={`Go to slide ${i + 1}`}
                        aria-current={i === activeMedia ? 'true' : undefined}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {media.length > 1 ? (
              <div className="product-page-thumbs" ref={thumbsRef} aria-label="Product media thumbnails">
                {media.map((item, index) => (
                  <button 
                    className={`product-page-thumb ${index === activeMedia ? 'active' : ''}`} 
                    onClick={() => scrollToSlide(index)} 
                    type="button" 
                    key={`${item.type}-${item.url}`}
                    aria-label={`Thumbnail ${index + 1}`}
                    aria-current={index === activeMedia ? 'true' : undefined}
                  >
                    {item.type === 'video' ? (
                      <>
                        <video src={item.url} preload="metadata" />
                        <i className="fa-solid fa-circle-play" />
                      </>
                    ) : (
                      <img src={cloudinaryImage(item.url, 160, { square: true })} alt="" loading="lazy" decoding="async" draggable="false" />
                    )}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <article className="product-detail-panel">
            <span className="product-detail-kicker">{product.category || 'BUYSELL Product'}</span>
            <h1>{product.name || 'Product'}</h1>
            <div className="product-detail-rating">
              <span>{Array.from({ length: 5 }, (_, index) => <i className="fa-solid fa-star" key={index} />)}</span>
              <strong>{Number(product.avg_rating || 5).toFixed(1)}</strong>
              <em>{Number(product.review_count || 0)} reviews</em>
            </div>
            <div className="product-detail-price">
              <strong>{money(product.price)}</strong>
              {product.original_price > product.price ? <><s>{money(product.original_price)}</s><span>-{discount}%</span></> : null}
            </div>
            <p className="product-detail-desc">{product.description || 'A BUYSELL marketplace product with seller support, checkout, and delivery tracking.'}</p>
            <div className="product-detail-pills">
              <span>{product.condition || 'new'}</span>
              <span>{product.location || 'Nigeria'}</span>
              <span className={inStock ? 'is-ok' : 'is-out'}>{inStock ? 'In stock' : 'Sold out'}</span>
              <span>Delivery {money(shippingFee(product))}</span>
            </div>
            <div className="product-detail-actions">
              <button className="btn btn-primary" onClick={() => addToCart()} disabled={!inStock}><i className="fa-solid fa-cart-plus" /> Add to Cart</button>
              <button className="btn btn-gold" onClick={buyNow} disabled={!inStock}><i className="fa-solid fa-bolt" /> Buy Now</button>
              <button className="btn btn-outline" onClick={shareProduct} type="button"><i className="fa-solid fa-share-nodes" /></button>
            </div>
            {product.negotiable ? <div className="product-negotiable-note"><i className="fa-solid fa-comments" /> Price is negotiable. Message the seller before checkout.</div> : null}
            <section className="product-page-seller-card">
              <div className="product-page-seller-avatar">{sellerName[0]?.toUpperCase() || 'S'}</div>
              <div>
                <h2>{sellerName}</h2>
                <p>{seller.seller_verified ? 'Verified BUYSELL seller' : 'Seller on BUYSELL Nigeria'}</p>
              </div>
              <a className="btn btn-outline btn-sm" href={`/?view=shop&store=${encodeURIComponent(product.seller_id || '')}`}><i className="fa-solid fa-store" /> Store</a>
            </section>
          </article>
        </section>
        <section className="product-detail-trust">
          <TrustItem icon="fa-lock" title="Verified Checkout" text="BUYSELL transfer receipt review" />
          <TrustItem icon="fa-truck-fast" title="BUYSELL Delivery" text="Pickup and tracking support" />
          <TrustItem icon="fa-message" title="Seller Chat" text="Ask questions before buying" />
          <TrustItem icon="fa-shield-halved" title="Marketplace Review" text="Admin support for order issues" />
        </section>
      </main>
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} onCartChange={cnt => setCount(cnt)} />
      {toast ? <div className="product-page-toast show">{toast}</div> : null}
    </>
  );
}

function ProductHeader({ count, onOpenCart, onBack }) {
  return (
    <header className="commerce-page-header product-page-header">
      <div className="commerce-page-header__brand">
        <button className="btn btn-outline btn-sm" onClick={onBack} type="button" title="Back">
          <i className="fa-solid fa-arrow-left" /> Back
        </button>
        <a className="category-brand category-brand--asset" href="/?view=shop"><BrandLogo variant="transparent" /></a>
      </div>
      <nav className="commerce-page-header__links" aria-label="Storefront navigation">
        <a href="/?view=shop">Marketplace</a>
        <a href="/products">Collections</a>
        <a href="/category/dropship">1688 Sourcing</a>
      </nav>
      <button className="product-cart-pill" onClick={onOpenCart} type="button" title="View Cart" aria-label={`Open cart, ${count} ${count === 1 ? 'item' : 'items'}`}>
        <i className="fa-solid fa-cart-shopping" /><span>{count}</span>
      </button>
    </header>
  );
}

function TrustItem({ icon, title, text }) {
  return (
    <div>
      <i className={`fa-solid ${icon}`} />
      <span><strong>{title}</strong><span>{text}</span></span>
    </div>
  );
}
