import { useEffect, useMemo, useState } from 'react';
import LoadingGrid from '../components/LoadingGrid.jsx';
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

export default function ProductPage() {
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState('loading');
  const [activeMedia, setActiveMedia] = useState(0);
  const [count, setCount] = useState(cartCount());
  const [toast, setToast] = useState('');
  const productId = new URLSearchParams(window.location.search).get('id') || new URLSearchParams(window.location.search).get('product');

  useEffect(() => {
    document.body.className = 'product-page';
  }, []);

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
        if (!cancelled) setStatus('error');
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
    setCount(cartCount());
    setToast('Added to cart');
    window.clearTimeout(addToCart.timer);
    addToCart.timer = window.setTimeout(() => setToast(''), 2200);
  }

  function buyNow() {
    addToCart(1);
    window.location.href = '/?view=shop&cart=open';
  }

  function shareProduct() {
    const text = `Check out "${product.name}" for ${money(product.price)} on BUYSELL Nigeria.`;
    if (navigator.share) navigator.share({ title: product.name, text, url: window.location.href }).catch(() => {});
    else navigator.clipboard?.writeText(`${window.location.href}\n${text}`).then(() => setToast('Product link copied'));
  }

  if (status === 'loading') {
    return (
      <>
        <ProductHeader count={count} />
        <main className="product-page-shell"><LoadingGrid count={2} className="product-page-loading" height={520} /></main>
      </>
    );
  }

  if (status !== 'ready') {
    const message = status === 'missing' ? 'Product not found.' : 'Could not load product.';
    return (
      <>
        <ProductHeader count={count} />
        <main className="product-page-shell">
          <section className="product-page-error">
            <i className="fa-solid fa-box-open" />
            <h1>{message}</h1>
            <p>This listing may have been removed or is temporarily unavailable.</p>
            <div className="product-page-error-actions">
              <a className="btn btn-primary" href="/">Market Landing</a>
              <a className="btn btn-outline" href="/products">Browse Products</a>
            </div>
          </section>
        </main>
      </>
    );
  }

  const selected = media[activeMedia] || media[0];

  return (
    <>
      <ProductHeader count={count} />
      <main className="product-page-shell">
        <section className="product-detail-hero">
          <div className="product-detail-gallery">
            <div className="product-page-main-media">
              {selected.type === 'video' ? <video src={selected.url} controls playsInline /> : <img src={selected.url} alt={product.name || 'Product'} />}
            </div>
            <div className="product-page-thumbs">
              {media.map((item, index) => (
                <button className={`product-page-thumb ${index === activeMedia ? 'active' : ''}`} onClick={() => setActiveMedia(index)} type="button" key={`${item.type}-${item.url}`}>
                  {item.type === 'video' ? <><video src={item.url} /><i className="fa-solid fa-circle-play" /></> : <img src={item.url} alt="" />}
                </button>
              ))}
            </div>
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
              <a className="btn btn-outline btn-sm" href={`/?store=${encodeURIComponent(product.seller_id || '')}`}><i className="fa-solid fa-store" /> Store</a>
            </section>
          </article>
        </section>
        <section className="product-detail-trust">
          <TrustItem icon="fa-lock" title="Secure Checkout" text="Flutterwave protected payment" />
          <TrustItem icon="fa-truck-fast" title="BUYSELL Delivery" text="Pickup and tracking support" />
          <TrustItem icon="fa-message" title="Seller Chat" text="Ask questions before buying" />
          <TrustItem icon="fa-shield-halved" title="Marketplace Review" text="Admin support for order issues" />
        </section>
      </main>
      {toast ? <div className="product-page-toast show">{toast}</div> : null}
    </>
  );
}

function ProductHeader({ count }) {
  return (
    <header className="product-page-header">
      <a className="category-brand" href="/">BUY<span>SELL</span></a>
      <nav>
        <a href="/">Home</a>
        <a href="/products">Collections</a>
        <a href="/category/dropship">1688 Sourcing</a>
        <a href="/?view=shop">Marketplace</a>
      </nav>
      <button className="product-cart-pill" onClick={() => { window.location.href = '/?view=shop&cart=open'; }} type="button">
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
