import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, CreditCard, Filter, Heart, MapPin, MessageCircle, Minus,
  PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Star,
  Store, Truck, Upload, X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProductCard } from '../components/ProductCard';
import { CardSkeleton, EmptyState, ErrorState, PageLoader } from '../components/States';
import { Seo } from '../components/Seo';
import { useCart } from '../contexts/CartContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { formatDate, formatMoney, nairaToKoboString, titleFromSlug } from '../lib/format';
import type { Address, Cart, Category, Order, PageResult, Product } from '../lib/types';

interface HomeData {
  categories: Category[];
  deals: Product[];
  featured: Product[];
  recentlyViewed?: Product[];
}

const trustPoints = [
  { icon: BadgeCheck, title: 'Verified sellers', text: 'Every business is reviewed before it can sell.' },
  { icon: ShieldCheck, title: 'Protected payments', text: 'Your payment stays protected throughout the order.' },
  { icon: Truck, title: 'Nationwide delivery', text: 'Reliable fulfilment across Nigeria.' },
  { icon: MessageCircle, title: 'Real support', text: 'Helpful people when you need them.' },
];

export function HomePage() {
  const home = useQuery({ queryKey: ['catalog', 'home'], queryFn: () => api.get<HomeData>('/catalog/home', { anonymous: true }), staleTime: 60_000 });

  return (
    <>
      <Seo title="BUYSELL — Buy. Sell. Smile." description="Discover quality products from verified Nigerian sellers, with secure payments and nationwide delivery." />
      <section className="hero container">
        <div className="hero__copy">
          <span className="eyebrow eyebrow--light"><BadgeCheck /> Nigeria’s trusted marketplace</span>
          <h1>Big finds.<br /><span>Better buying.</span></h1>
          <p>Shop confidently from verified businesses, pay securely and get every order delivered with care.</p>
          <div className="hero__actions"><Link className="button button--light" to="/products">Shop now <ArrowRight /></Link><Link className="button button--ghost-light" to="/signup/seller">Start selling</Link></div>
          <div className="hero__proof"><span><strong>Verified</strong> marketplace sellers</span><span><strong>Protected</strong> checkout records</span><span><strong>Nigeria-wide</strong> delivery support</span></div>
        </div>
        <div className="hero__visual" aria-label="Featured marketplace products">
          <div className="hero__orb hero__orb--one" />
          <div className="hero-product hero-product--main">{home.data?.deals[3]?.image ? <img src={home.data.deals[3].image} alt="Featured marketplace product" /> : <span><Store /></span>}</div>
          <div className="hero-product hero-product--top">{home.data?.deals[2]?.image ? <img src={home.data.deals[2].image} alt="Featured marketplace product" /> : <span><ShoppingBag /></span>}</div>
          <div className="hero-product hero-product--bottom">{home.data?.deals[1]?.image ? <img src={home.data.deals[1].image} alt="Featured marketplace product" /> : <span><PackageCheck /></span>}</div>
          <span className="hero__deal"><strong>Up to 40%</strong> selected deals</span>
        </div>
      </section>

      <section className="category-strip container" aria-labelledby="shop-category-heading">
        <div className="section-heading"><div><span className="eyebrow">Find your next favourite</span><h2 id="shop-category-heading">Shop by category</h2></div><Link to="/products">View all <ArrowRight /></Link></div>
        {home.isLoading ? <div className="category-row">{Array.from({ length: 6 }, (_, index) => <span className="category-pill category-pill--skeleton" key={index} />)}</div> : home.isError ? <ErrorState title="Categories are taking a break" onRetry={() => void home.refetch()} /> : (
          <div className="category-row">{home.data?.categories.map((category, index) => <Link className="category-pill" to={`/category/${category.slug}`} key={category.id}><span className={`category-pill__art category-pill__art--${index % 6}`}>{category.name.slice(0, 1)}</span><strong>{category.name}</strong><small>{category.productCount ? `${category.productCount.toLocaleString()} items` : 'Explore now'}</small></Link>)}</div>
        )}
      </section>

      <ProductSection title="Today’s best deals" eyebrow="Selected savings" products={home.data?.deals} loading={home.isLoading} error={home.isError} retry={() => void home.refetch()} href="/products?sort=deals" />

      <section className="value-banner container">
        <div><span className="eyebrow eyebrow--light">Product sourcing</span><h2>Need something specific for your business?</h2><p>Send a product link or brief. Our team will review it and prepare a transparent quote.</p><Link className="button button--light" to="/sourcing">Start a request <ArrowRight /></Link></div>
        <div className="value-banner__steps"><span><b>1</b> Share your item</span><span><b>2</b> Review your quote</span><span><b>3</b> Track fulfilment</span></div>
      </section>

      <ProductSection title="Featured for you" eyebrow="Curated picks" products={home.data?.featured} loading={home.isLoading} error={home.isError} retry={() => void home.refetch()} href="/products?sort=featured" />

      <section className="trust-grid container" aria-label="Why shop on BUYSELL">{trustPoints.map(({ icon: TrustIcon, title, text }) => <article key={title}><span><TrustIcon /></span><div><h3>{title}</h3><p>{text}</p></div></article>)}</section>

      <section className="seller-callout container"><div><span className="eyebrow">Built for Nigerian businesses</span><h2>Turn what you sell into a store people trust.</h2><p>Manage products, orders, customers and payouts from one focused seller centre.</p></div><Link className="button button--primary" to="/signup/seller">Open your store <ArrowRight /></Link></section>
    </>
  );
}

function ProductSection({ title, eyebrow, products, loading, error, retry, href }: { title: string; eyebrow: string; products?: Product[]; loading: boolean; error: boolean; retry: () => void; href: string }) {
  return (
    <section className="product-section container">
      <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><Link to={href}>View all <ArrowRight /></Link></div>
      {loading ? <CardSkeleton count={4} /> : error ? <ErrorState onRetry={retry} /> : !products?.length ? <EmptyState title="No products here yet" message="Fresh finds will appear here as sellers add them." /> : <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>}
    </section>
  );
}

export function CatalogPage() {
  const { categorySlug, subcategorySlug } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const isSearch = location.pathname === '/search';
  const title = isSearch ? (query ? `Results for “${query}”` : 'Search the marketplace') : categorySlug ? titleFromSlug(subcategorySlug ?? categorySlug) : 'All products';

  const products = useQuery({
    queryKey: ['catalog', 'products', categorySlug, subcategorySlug, query, sort, params.get('min'), params.get('max')],
    queryFn: () => {
      const requestParams = new URLSearchParams(params);
      if (categorySlug) requestParams.set('category', categorySlug);
      requestParams.delete('min');
      requestParams.delete('max');
      if (params.get('min')) requestParams.set('minPriceKobo', nairaToKoboString(params.get('min')));
      if (params.get('max')) requestParams.set('maxPriceKobo', nairaToKoboString(params.get('max')));
      const path = isSearch ? '/catalog/search' : '/catalog/products';
      return api.get<PageResult<Product>>(`${path}?${requestParams.toString()}`, { anonymous: true });
    },
    staleTime: 30_000,
  });

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  return (
    <>
      <Seo title={title} description={`Shop ${title.toLowerCase()} from verified sellers on BUYSELL.`} />
      <div className="catalog-page container">
        <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight />{categorySlug && <><Link to="/products">Products</Link><ChevronRight /></>}<span>{title}</span></nav>
        <header className="catalog-header">
          <div><span className="eyebrow">Marketplace</span><h1>{title}</h1><p>{products.data?.total ?? 0} quality products from verified stores</p></div>
          <div className="catalog-header__actions"><button className="button button--secondary filters-trigger" onClick={() => setFiltersOpen(true)}><Filter /> Filters</button><label className="select-control"><span>Sort</span><select value={sort} onChange={(event) => updateParam('sort', event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option></select><ChevronDown /></label></div>
        </header>
        <div className="catalog-layout">
          <aside className={`filters${filtersOpen ? ' is-open' : ''}`}>
            <div className="filters__head"><h2><SlidersHorizontal /> Filters</h2><button className="icon-button filters__close" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X /></button></div>
            <FilterGroup title="Category"><label><input type="radio" name="category" checked={!categorySlug} onChange={() => location.pathname !== '/products' && window.location.assign('/products')} /> All categories</label><label><input type="radio" name="category" checked={categorySlug === 'electronics'} onChange={() => window.location.assign('/category/electronics')} /> Electronics</label><label><input type="radio" name="category" checked={categorySlug === 'fashion'} onChange={() => window.location.assign('/category/fashion')} /> Fashion</label><label><input type="radio" name="category" checked={categorySlug === 'home-living'} onChange={() => window.location.assign('/category/home-living')} /> Home & living</label></FilterGroup>
            <FilterGroup title="Price range"><div className="price-filter"><label><span>Min</span><input inputMode="numeric" placeholder="₦0" defaultValue={params.get('min') ?? ''} onBlur={(event) => updateParam('min', event.target.value)} /></label><label><span>Max</span><input inputMode="numeric" placeholder="Any" defaultValue={params.get('max') ?? ''} onBlur={(event) => updateParam('max', event.target.value)} /></label></div></FilterGroup>
            <FilterGroup title="Condition"><label><input type="radio" name="condition" onChange={() => updateParam('condition', 'NEW')} checked={params.get('condition') === 'NEW'} /> New</label><label><input type="radio" name="condition" onChange={() => updateParam('condition', 'USED')} checked={params.get('condition') === 'USED'} /> Used</label><label><input type="radio" name="condition" onChange={() => updateParam('condition', 'REFURBISHED')} checked={params.get('condition') === 'REFURBISHED'} /> Refurbished</label></FilterGroup>
            <button className="button button--primary filters__apply" onClick={() => setFiltersOpen(false)}>Show results</button>
          </aside>
          <div className="catalog-results">
            {products.isLoading ? <CardSkeleton count={8} /> : products.isError ? <ErrorState title="We couldn’t load these products" message={products.error.message} onRetry={() => void products.refetch()} /> : !products.data?.items.length ? <EmptyState title="No matches found" message="Try a broader search or clear a few filters." action={<Link className="button button--secondary" to="/products">Browse all products</Link>} /> : <div className="product-grid">{products.data.items.map((product) => <ProductCard key={product.id} product={product} />)}</div>}
            {!!products.data?.totalPages && products.data.totalPages > 1 && <nav className="pagination" aria-label="Product pages"><button aria-label="Previous page"><ArrowLeft /></button><button className="is-active">1</button><button>2</button><button>3</button><button aria-label="Next page"><ArrowRight /></button></nav>}
          </div>
        </div>
      </div>
      {filtersOpen && <button className="filters-backdrop" onClick={() => setFiltersOpen(false)} aria-label="Close filters" />}
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="filter-group"><legend>{title}</legend>{children}</fieldset>;
}

export function ProductPage() {
  const { productSlug = '' } = useParams();
  const navigate = useNavigate();
  const { addItem, adding } = useCart();
  const { notify } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const product = useQuery({ queryKey: ['catalog', 'product', productSlug], queryFn: () => api.get<Product>(`/catalog/products/${encodeURIComponent(productSlug)}`, { anonymous: true }), staleTime: 30_000 });

  const add = async (checkout = false) => {
    if (!product.data) return;
    try {
      await addItem(product.data.id, quantity, product.data.variantId);
      if (checkout) navigate('/cart'); else notify(`${product.data.name} added to your cart`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not add this item', 'error'); }
  };

  if (product.isLoading) return <div className="container page-pad"><PageLoader label="Loading product details" /></div>;
  if (product.isError || !product.data) return <div className="container page-pad"><ErrorState title="Product unavailable" message={product.error?.message ?? 'This product could not be found.'} onRetry={() => void product.refetch()} /></div>;
  const item = product.data;
  const images = item.images?.length ? item.images : item.image ? [item.image] : [];

  return (
    <>
      <Seo title={item.name} description={item.description?.slice(0, 155)} />
      <div className="product-page container">
        <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight /><Link to="/products">Products</Link><ChevronRight /><span>{item.name}</span></nav>
        <div className="product-detail">
          <section className="product-gallery" aria-label="Product images">
            <div className="product-gallery__main">{images[activeImage] ? <img src={images[activeImage]} alt={item.name} /> : <span>BS</span>}<button className="product-gallery__save" aria-label="Save product"><Heart /></button></div>
            {images.length > 1 && <div className="product-gallery__thumbs">{images.map((imageUrl, index) => <button className={activeImage === index ? 'is-active' : ''} key={imageUrl} onClick={() => setActiveImage(index)}><img src={imageUrl} alt={`${item.name}, view ${index + 1}`} /></button>)}</div>}
          </section>
          <section className="product-buybox">
            {item.badge && <span className="deal-label">Deal {item.badge}</span>}
            <h1>{item.name}</h1>
            <div className="product-buybox__rating"><span><Star /> {item.rating?.toFixed(1) ?? 'New'}</span><a href="#reviews">{item.reviewCount ?? 0} reviews</a><span>{item.stock && item.stock > 0 ? `${item.stock} in stock` : 'Check availability'}</span></div>
            <div className="product-buybox__price"><strong>{formatMoney(item.price, item.currency)}</strong>{item.compareAtPrice && <s>{formatMoney(item.compareAtPrice, item.currency)}</s>}<small>Price includes applicable platform fees</small></div>
            <p className="product-buybox__description">{item.description}</p>
            <div className="purchase-controls"><div className="quantity-control"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity"><Minus /></button><span aria-live="polite">{quantity}</span><button onClick={() => setQuantity((value) => Math.min(item.stock ?? 99, value + 1))} aria-label="Increase quantity"><Plus /></button></div><span>{item.stock ? `${item.stock} available` : 'Availability confirmed at checkout'}</span></div>
            <div className="product-buybox__actions"><button className="button button--primary button--large" onClick={() => void add(true)} disabled={adding}><ShoppingBag /> Buy now</button><button className="button button--secondary button--large" onClick={() => void add()} disabled={adding}>Add to cart</button></div>
            <div className="buybox-assurances"><span><ShieldCheck /> Secure, protected payment</span><span><Truck /> Delivery options shown at checkout</span><span><PackageCheck /> Easy issue resolution</span></div>
            {item.store && <Link className="seller-card" to={`/store/${item.store.slug}`}><span className="seller-card__avatar"><Store /></span><div><small>Sold by</small><strong>{item.store.name} {item.store.verified && <BadgeCheck />}</strong><span>{item.store.rating ? `${item.store.rating} seller rating` : 'Marketplace seller'}</span></div><ChevronRight /></Link>}
          </section>
        </div>
        <section className="product-information"><article><h2>Product details</h2><p>{item.description ?? 'The seller has not added additional details yet.'}</p><ul><li>Quality checked marketplace listing</li><li>Protected payment through BUYSELL</li><li>Order updates from payment to delivery</li></ul></article><aside><h2>Delivery & returns</h2><p><MapPin /> Delivery cost and timing depend on your address.</p><p><ShieldCheck /> If there is an issue, raise it from your order before the protection window closes.</p><Link to="/buyer-protection">Read buyer protection <ArrowRight /></Link></aside></section>
        <section id="reviews" className="reviews-section"><div className="section-heading"><div><span className="eyebrow">Verified purchases</span><h2>Customer reviews</h2></div><button className="button button--secondary">Write a review</button></div><EmptyState title="Reviews will appear here" message="Only customers who purchased this product can leave a review." /></section>
      </div>
      <div className="mobile-buybar"><div><small>{item.name}</small><strong>{formatMoney(item.price, item.currency)}</strong></div><button className="button button--primary" onClick={() => void add()} disabled={adding}>Add to cart</button></div>
    </>
  );
}

export function StorePage() {
  const { storeSlug = '' } = useParams();
  const store = useQuery({ queryKey: ['catalog', 'store', storeSlug], queryFn: () => api.get<{ name: string; slug: string; verified: boolean; description?: string; rating?: number; products: Product[] }>(`/catalog/stores/${encodeURIComponent(storeSlug)}`, { anonymous: true }) });
  if (store.isLoading) return <div className="container page-pad"><PageLoader label="Opening store" /></div>;
  if (store.isError || !store.data) return <div className="container page-pad"><ErrorState title="Store unavailable" message={store.error?.message} onRetry={() => void store.refetch()} /></div>;
  return <><Seo title={store.data.name} description={store.data.description} /><div className="store-page container"><header className="store-hero"><span className="store-hero__logo"><Store /></span><div><span className="eyebrow">Marketplace store</span><h1>{store.data.name} {store.data.verified && <BadgeCheck />}</h1><p>{store.data.description}</p><span><Star /> {store.data.rating ?? 'New'} seller rating</span></div><button className="button button--light"><Heart /> Follow store</button></header><section className="product-section"><div className="section-heading"><div><h2>Products from this store</h2><p>{store.data.products.length} listings</p></div></div>{store.data.products.length ? <div className="product-grid">{store.data.products.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <EmptyState title="No products yet" message="This store has not published any products." />}</section></div></>;
}

export function CartPage() {
  const { cart, loading, error, updateItem, removeItem } = useCart();
  const { notify } = useToast();

  if (loading) return <div className="container page-pad"><PageLoader label="Loading your cart" /></div>;
  if (error) return <div className="container page-pad"><ErrorState title="Your cart is unavailable" message={error.message} /></div>;

  return (
    <>
      <Seo title="Your cart" noIndex />
      <div className="cart-page container">
        <header className="page-heading"><div><span className="eyebrow">Almost yours</span><h1>Your cart</h1><p>{cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} ready for checkout</p></div><Link to="/products">Continue shopping <ArrowRight /></Link></header>
        {!cart.items.length ? <EmptyState title="Your cart is waiting" message="Explore the marketplace and add something you love." action={<Link className="button button--primary" to="/products">Start shopping</Link>} /> : (
          <div className="cart-layout">
            <section className="cart-items" aria-label="Cart items">
              {cart.items.map(({ id, quantity, product }) => (
                <article className="cart-item" key={id}>
                  <Link className="cart-item__image" to={`/product/${product.slug}`}>{product.image ? <img src={product.image} alt="" /> : <span>BS</span>}</Link>
                  <div className="cart-item__details"><small>{product.store?.name ?? 'BUYSELL seller'}</small><Link to={`/product/${product.slug}`}>{product.name}</Link><span>{product.stock ? `${product.stock} available` : 'In stock'}</span><button onClick={() => void removeItem(id).catch(() => notify('Could not remove this item', 'error'))}><X /> Remove</button></div>
                  <div className="cart-item__end"><strong>{formatMoney(Number(product.price) * quantity, product.currency)}</strong><div className="quantity-control"><button aria-label={`Decrease ${product.name} quantity`} onClick={() => quantity === 1 ? void removeItem(id) : void updateItem(id, quantity - 1)}><Minus /></button><span>{quantity}</span><button aria-label={`Increase ${product.name} quantity`} onClick={() => void updateItem(id, quantity + 1)}><Plus /></button></div></div>
                </article>
              ))}
            </section>
            <OrderSummary subtotal={cart.subtotal} action={<Link className="button button--primary button--full button--large" to="/checkout">Proceed to checkout <ArrowRight /></Link>} />
          </div>
        )}
      </div>
    </>
  );
}

function OrderSummary({ subtotal, delivery, total, action }: { subtotal: number | string; delivery?: number | string; total?: number | string; action?: ReactNode }) {
  return (
    <aside className="order-summary">
      <h2>Order summary</h2>
      <dl><div><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div><div><dt>Delivery</dt><dd>{delivery === undefined ? 'At checkout' : Number(delivery) === 0 ? 'Free' : formatMoney(delivery)}</dd></div><div><dt>Buyer protection</dt><dd>Included</dd></div>{total !== undefined && <div className="order-summary__total"><dt>Total</dt><dd>{formatMoney(total)}</dd></div>}</dl>
      {action}
      <p><ShieldCheck /> Payments are encrypted and protected.</p>
    </aside>
  );
}

interface CheckoutQuote {
  id: string;
  subtotal: number | string;
  deliveryFee: number | string;
  discount?: number | string;
  total: number | string;
  expiresAt: string;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart } = useCart();
  const { notify } = useToast();
  const [selectedAddress, setSelectedAddress] = useState('');
  const addresses = useQuery({ queryKey: ['account', 'addresses'], queryFn: () => api.get<PageResult<Address>>('/account/addresses') });
  const defaultAddress = selectedAddress || addresses.data?.items.find((address) => address.isDefault)?.id || addresses.data?.items[0]?.id || '';
  const quote = useQuery({ queryKey: ['checkout', 'quote', defaultAddress, cart.itemCount], queryFn: () => api.post<CheckoutQuote>('/checkout/quotes', { addressId: defaultAddress }), enabled: Boolean(defaultAddress && cart.items.length), staleTime: 60_000 });
  const order = useMutation({
    mutationFn: async () => {
      if (!quote.data || !defaultAddress) throw new Error('Choose a delivery address first.');
      const idempotencyKey = crypto.randomUUID();
      const created = await api.post<{ id: string; orderNumber: string; status: string }>('/orders', { quoteId: quote.data.id }, { idempotencyKey });
      const payment = await api.post<{ checkoutUrl?: string }>(`/orders/${encodeURIComponent(created.id)}/payments/flutterwave`);
      return { created, payment };
    },
    onSuccess: ({ created, payment }) => {
      if (payment.checkoutUrl) window.location.assign(payment.checkoutUrl);
      else navigate(`/checkout/success?order=${encodeURIComponent(created.id)}`);
    },
    onError: (error) => notify(error.message, 'error'),
  });

  return (
    <>
      <Seo title="Secure checkout" noIndex />
      <div className="checkout-page container">
        <header className="checkout-header"><Link to="/cart"><ArrowLeft /> Back to cart</Link><div><span className="eyebrow">Protected payment</span><h1>Checkout</h1></div><span><ShieldCheck /> Secure checkout</span></header>
        <div className="checkout-layout">
          <div className="checkout-main">
            <section className="checkout-section"><div className="checkout-section__head"><span>1</span><div><h2>Delivery address</h2><p>Where should we send your order?</p></div><Link to="/account/addresses">Manage</Link></div>{addresses.isLoading ? <PageLoader label="Loading addresses" /> : addresses.isError ? <ErrorState title="Addresses unavailable" message={addresses.error.message} onRetry={() => void addresses.refetch()} /> : !addresses.data?.items.length ? <EmptyState title="Add a delivery address" message="We need an address to calculate delivery and create a quote." action={<Link className="button button--primary" to="/account/addresses">Add address</Link>} /> : <div className="address-list">{addresses.data.items.map((address) => <label className={`address-card${defaultAddress === address.id ? ' is-selected' : ''}`} key={address.id}><input type="radio" name="delivery-address" checked={defaultAddress === address.id} onChange={() => setSelectedAddress(address.id)} /><span><strong>{address.label} {address.isDefault && <small>Default</small>}</strong><b>{address.fullName}</b><span>{address.addressLine1}, {address.city}, {address.state}</span><span>{address.phone}</span></span><Check /></label>)}</div>}</section>
            <section className="checkout-section"><div className="checkout-section__head"><span>2</span><div><h2>Delivery</h2><p>Tracked delivery to your selected address.</p></div></div><label className="delivery-option"><input type="radio" checked readOnly /><Truck /><span><strong>Standard delivery</strong><small>Final timing appears after payment</small></span><b>{quote.data ? formatMoney(quote.data.deliveryFee) : '—'}</b></label></section>
            <section className="checkout-section"><div className="checkout-section__head"><span>3</span><div><h2>Payment</h2><p>You’ll continue to our secure payment partner.</p></div></div><div className="payment-method"><CreditCard /><div><strong>Card, bank transfer or mobile money</strong><span>Available methods are shown securely on the next step.</span></div><ShieldCheck /></div></section>
          </div>
          {quote.isLoading ? <aside className="order-summary"><PageLoader label="Calculating total" /></aside> : quote.isError ? <aside className="order-summary"><ErrorState title="Could not calculate checkout" message={quote.error.message} onRetry={() => void quote.refetch()} /></aside> : <OrderSummary subtotal={quote.data?.subtotal ?? cart.subtotal} delivery={quote.data?.deliveryFee} total={quote.data?.total} action={<button className="button button--primary button--full button--large" disabled={!quote.data || order.isPending} onClick={() => order.mutate()}>{order.isPending ? <><span className="spinner spinner--small" /> Preparing payment</> : <>Pay {quote.data ? formatMoney(quote.data.total) : ''} <ArrowRight /></>}</button>} />}
        </div>
      </div>
    </>
  );
}

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const orderId = params.get('order');
  const paymentId = params.get('payment');
  const transactionId = params.get('transaction_id');
  const providerStatus = (params.get('status') ?? '').toLowerCase();
  const providerReturnedSuccess = ['successful', 'completed', 'success'].includes(providerStatus);
  const verify = useMutation({ mutationFn: () => api.post(`/payments/${encodeURIComponent(paymentId!)}/verify`, { transactionId: transactionId! }) });

  useEffect(() => {
    if (providerReturnedSuccess && paymentId && transactionId && verify.isIdle) verify.mutate();
  }, [providerReturnedSuccess, paymentId, transactionId, verify]);

  const verified = verify.isSuccess;
  const verifying = verify.isPending;
  const verificationFailed = verify.isError;
  return <><Seo title={verified ? 'Payment confirmed' : 'Payment status'} noIndex /><div className="confirmation-page container">{verifying ? <><span className="spinner" /><span className="eyebrow">Checking with the payment provider</span><h1>We’re verifying your payment.</h1><p>Keep this page open. Your order will only progress after BUYSELL confirms the transaction with the provider.</p></> : verified ? <><span className="confirmation-page__icon"><Check /></span><span className="eyebrow">Payment verified</span><h1>Your payment is confirmed.</h1><p>Your order record has been updated after server-side verification.</p></> : verificationFailed ? <><span className="confirmation-page__icon confirmation-page__icon--error"><X /></span><span className="eyebrow">Verification incomplete</span><h1>We could not confirm this payment yet.</h1><p>{verify.error.message} Check the order again shortly or contact support if your account was charged.</p><button className="button button--primary" onClick={() => verify.mutate()}>Try verification again</button></> : <><span className="confirmation-page__icon confirmation-page__icon--pending"><Clock3 /></span><span className="eyebrow">Payment not confirmed</span><h1>Check your order for the latest status.</h1><p>{providerStatus && !providerReturnedSuccess ? 'The payment provider did not report a completed transaction.' : 'The redirect did not include enough information to verify payment. No confirmation has been assumed.'}</p></>}{orderId && <strong>Order reference: {orderId}</strong>}<div><Link className="button button--primary" to={orderId ? `/orders/${orderId}` : '/orders'}>View order <ArrowRight /></Link><Link className="button button--secondary" to="/products">Return to marketplace</Link></div></div></>;
}

export function OrdersPage() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api.get<PageResult<Order>>('/orders') });
  return <><Seo title="Your orders" noIndex /><div className="container content-page"><header className="page-heading"><div><span className="eyebrow">Your purchases</span><h1>Orders</h1><p>Track deliveries, view receipts and get help.</p></div></header>{orders.isLoading ? <PageLoader label="Loading orders" /> : orders.isError ? <ErrorState title="Orders unavailable" message={orders.error.message} onRetry={() => void orders.refetch()} /> : !orders.data?.items.length ? <EmptyState title="No orders yet" message="Your purchases will appear here." action={<Link className="button button--primary" to="/products">Shop products</Link>} /> : <div className="order-list">{orders.data.items.map((order) => <Link className="order-card" to={`/orders/${order.id}`} key={order.id}>{order.thumbnail ? <img src={order.thumbnail} alt="" /> : <span className="order-card__image"><PackageCheck /></span>}<div><small>{formatDate(order.createdAt)}</small><strong>{order.orderNumber}</strong><span>{order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} · {order.storeName}</span></div><div><span className={`status status--${order.status.toLowerCase().replaceAll('_', '-')}`}>{titleFromSlug(order.status)}</span><strong>{formatMoney(order.total)}</strong></div><ChevronRight /></Link>)}</div>}</div></>;
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<Order>(`/orders/${encodeURIComponent(orderId)}`) });
  if (order.isLoading) return <div className="container page-pad"><PageLoader label="Loading order" /></div>;
  if (order.isError || !order.data) return <div className="container page-pad"><ErrorState title="Order unavailable" message={order.error?.message} onRetry={() => void order.refetch()} /></div>;
  const step = ['PAID', 'PROCESSING', 'READY', 'IN_TRANSIT', 'DELIVERED'].indexOf(order.data.status);
  return <><Seo title={`Order ${order.data.orderNumber}`} noIndex /><div className="container order-detail"><Link className="back-link" to="/orders"><ArrowLeft /> All orders</Link><header className="page-heading"><div><span className="eyebrow">Order {order.data.orderNumber}</span><h1>{titleFromSlug(order.data.status)}</h1><p>Placed {formatDate(order.data.createdAt)}</p></div><strong>{formatMoney(order.data.total)}</strong></header><section className="order-progress" aria-label="Order progress">{['Payment confirmed', 'Being prepared', 'Ready to send', 'On the way', 'Delivered'].map((label, index) => <div className={index <= step ? 'is-complete' : ''} key={label}><span>{index < step ? <Check /> : index + 1}</span><strong>{label}</strong></div>)}</section><div className="order-detail__grid"><section className="surface-card"><h2>Items</h2><p>{order.data.itemCount} {order.data.itemCount === 1 ? 'item' : 'items'} from {order.data.storeName ?? 'BUYSELL sellers'}.</p><hr /><div className="line-item"><span>Order total</span><strong>{formatMoney(order.data.total)}</strong></div></section><aside className="surface-card"><h2>Need help?</h2><p>Message support or raise an issue from this order. We’ll preserve the order context for faster help.</p><Link className="button button--secondary button--full" to={`/messages?order=${order.data.id}`}><MessageCircle /> Contact support</Link></aside></div></div></>;
}

const accountSections: Record<string, { title: string; intro: string; endpoint: string }> = {
  account: { title: 'Account overview', intro: 'Manage your details, delivery preferences and BUYSELL activity.', endpoint: '/account' },
  profile: { title: 'Profile', intro: 'Keep your personal information accurate and up to date.', endpoint: '/account/profile' },
  addresses: { title: 'Delivery addresses', intro: 'Save the places where you receive orders.', endpoint: '/account/addresses' },
  security: { title: 'Security', intro: 'Review sessions and strengthen your account access.', endpoint: '/account/security' },
  notifications: { title: 'Notification preferences', intro: 'Choose which important updates you receive.', endpoint: '/account/notifications' },
};

export function AccountPage({ section = 'account' }: { section?: string }) {
  const config = accountSections[section] ?? accountSections.account!;
  const endpoint = section === 'notifications' ? '/account/notification-preferences' : config.endpoint;
  const details = useQuery({ queryKey: ['account', section], queryFn: () => api.get<Record<string, any>>(endpoint), retry: 1, enabled: section !== 'account' && section !== 'security' });
  const { notify } = useToast();
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => section === 'notifications' ? api.put(endpoint, { emailOrderUpdates: Boolean(body.orderUpdates), pushMessages: Boolean(body.messages), marketingEmail: Boolean(body.offers) }) : section === 'addresses' ? api.post(endpoint, body) : api.patch(endpoint, body), onSuccess: () => notify('Your changes have been saved.'), onError: (error) => notify(error.message, 'error') });

  return (
    <><Seo title={config.title} noIndex /><div className="account-page container"><aside className="account-nav"><h2>Your account</h2><nav><Link to="/account">Overview</Link><Link to="/account/profile">Profile</Link><Link to="/account/addresses">Addresses</Link><Link to="/orders">Orders</Link><Link to="/wishlist">Wishlist</Link><Link to="/messages">Messages</Link><Link to="/account/security">Security</Link><Link to="/account/notifications">Notifications</Link></nav></aside><section className="account-content"><header className="page-heading"><div><span className="eyebrow">Personal settings</span><h1>{config.title}</h1><p>{config.intro}</p></div></header>{details.isLoading ? <PageLoader /> : section === 'addresses' ? <AddressManager data={details.data} onSave={(body) => save.mutate(body)} saving={save.isPending} /> : <ProfileSettings section={section} data={details.data} onSave={(body) => save.mutate(body)} saving={save.isPending} />}</section></div></>
  );
}

function ProfileSettings({ section, data, onSave, saving }: { section: string; data?: Record<string, any>; onSave: (body: Record<string, unknown>) => void; saving: boolean }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(Object.fromEntries(new FormData(event.currentTarget)));
  };
  if (section === 'account') return <div className="account-overview"><Link to="/orders"><PackageCheck /><span><strong>Orders</strong><small>Track purchases and deliveries</small></span><ChevronRight /></Link><Link to="/wishlist"><Heart /><span><strong>Wishlist</strong><small>Keep your favourite finds together</small></span><ChevronRight /></Link><Link to="/account/security"><ShieldCheck /><span><strong>Security</strong><small>Protect your BUYSELL account</small></span><ChevronRight /></Link><Link to="/seller/dashboard"><Store /><span><strong>Seller centre</strong><small>Manage your store and orders</small></span><ChevronRight /></Link></div>;
  if (section === 'security') return <div className="settings-stack"><article className="surface-card"><h2>Password</h2><p>Your password is managed securely through BUYSELL authentication.</p><Link className="button button--secondary" to="/forgot-password">Change password</Link></article><article className="surface-card"><h2>Active sessions</h2><p>Sign out from this device when you use a shared computer.</p><button className="button button--danger">Sign out other sessions</button></article></div>;
  if (section === 'notifications') return <form className="settings-form" onSubmit={submit}><PreferenceToggle name="orderUpdates" label="Order updates" detail="Payment, dispatch and delivery progress" defaultChecked={data?.orderUpdates !== false} /><PreferenceToggle name="messages" label="Messages" detail="New messages from sellers and support" defaultChecked={data?.messages !== false} /><PreferenceToggle name="offers" label="Offers and recommendations" detail="Relevant deals and marketplace news" defaultChecked={data?.offers === true} /><button className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button></form>;
  return <form className="settings-form" onSubmit={submit}><div className="form-grid"><label><span>Full name</span><input name="displayName" defaultValue={data?.displayName ?? ''} autoComplete="name" /></label><label><span>Phone number</span><input name="phone" defaultValue={data?.phone ?? ''} autoComplete="tel" /></label><label className="form-field--full"><span>Email address</span><input name="email" defaultValue={data?.email ?? ''} type="email" autoComplete="email" disabled /></label></div><button className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></form>;
}

function PreferenceToggle({ name, label, detail, defaultChecked }: { name: string; label: string; detail: string; defaultChecked: boolean }) {
  return <label className="preference-toggle"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" name={name} defaultChecked={defaultChecked} /><i aria-hidden="true" /></label>;
}

function AddressManager({ data, onSave, saving }: { data?: Record<string, any>; onSave: (body: Record<string, unknown>) => void; saving: boolean }) {
  const addresses = (data?.items ?? []) as Address[];
  const [adding, setAdding] = useState(!addresses.length);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSave(Object.fromEntries(new FormData(event.currentTarget))); };
  return <div className="settings-stack">{addresses.map((address) => <article className="address-manage-card" key={address.id}><span><MapPin /></span><div><strong>{address.label} {address.isDefault && <small>Default</small>}</strong><p>{address.fullName} · {address.phone}</p><p>{address.addressLine1}, {address.city}, {address.state}</p></div><button className="button button--text">Edit</button></article>)}{adding ? <form className="settings-form" onSubmit={submit}><h2>Add an address</h2><div className="form-grid"><label><span>Label</span><input name="label" placeholder="Home" required /></label><label><span>Full name</span><input name="fullName" autoComplete="name" required /></label><label><span>Phone</span><input name="phone" autoComplete="tel" required /></label><label><span>State</span><input name="state" required /></label><label className="form-field--full"><span>Street address</span><input name="addressLine1" autoComplete="street-address" required /></label><label><span>City</span><input name="city" required /></label></div><div className="form-actions"><button className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save address'}</button>{addresses.length > 0 && <button type="button" className="button button--secondary" onClick={() => setAdding(false)}>Cancel</button>}</div></form> : <button className="button button--primary" onClick={() => setAdding(true)}><Plus /> Add address</button>}</div>;
}

interface SimpleRecord { id: string; name?: string; primary?: string; secondary?: string; status?: string; value?: string; date?: string; [key: string]: unknown }

export function BuyerCollectionPage({ kind }: { kind: 'wishlist' | 'messages' }) {
  const endpoint = `/${kind}`;
  const result = useQuery({ queryKey: [kind], queryFn: () => api.get<PageResult<SimpleRecord> | { items: Product[] }>(endpoint) });
  const title = kind === 'wishlist' ? 'Your wishlist' : 'Messages';
  return <><Seo title={title} noIndex /><div className="container content-page"><header className="page-heading"><div><span className="eyebrow">Your BUYSELL</span><h1>{title}</h1><p>{kind === 'wishlist' ? 'The products you have saved for later.' : 'Conversations with sellers and support.'}</p></div></header>{result.isLoading ? <PageLoader /> : result.isError ? <ErrorState title={`${title} unavailable`} message={result.error.message} onRetry={() => void result.refetch()} /> : !(result.data?.items.length) ? <EmptyState title={kind === 'wishlist' ? 'Nothing saved yet' : 'No messages yet'} message={kind === 'wishlist' ? 'Tap the heart on a product to keep it here.' : 'Conversations about products and orders will appear here.'} action={kind === 'wishlist' ? <Link className="button button--primary" to="/products">Explore products</Link> : undefined} /> : kind === 'wishlist' ? <div className="product-grid">{(result.data.items as Product[]).map((product) => <ProductCard product={product} key={product.id} />)}</div> : <div className="conversation-list">{result.data.items.map((row) => <Link to={`/messages/${row.id}`} key={row.id}><span className="conversation-list__avatar"><MessageCircle /></span><div><strong>{row.primary ?? row.name}</strong><p>{row.secondary ?? 'Open conversation'}</p></div><small>{row.date}</small></Link>)}</div>}</div></>;
}

export function ConversationPage() {
  const { conversationId = '' } = useParams();
  const messages = useQuery({ queryKey: ['messages', conversationId], queryFn: () => api.get<{ participant?: string; items: Array<{ id: string; body: string; sentAt: string; own: boolean }> }>(`/conversations/${encodeURIComponent(conversationId)}/messages`) });
  const queryClient = useQueryClient();
  const send = useMutation({ mutationFn: (body: string) => api.post(`/conversations/${encodeURIComponent(conversationId)}/messages`, { body }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] }) });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem('message') as HTMLInputElement; if (field.value.trim()) { send.mutate(field.value.trim()); field.value = ''; } };
  return <><Seo title="Conversation" noIndex /><div className="container message-page"><header><Link to="/messages"><ArrowLeft /></Link><span className="conversation-list__avatar"><MessageCircle /></span><div><h1>{messages.data?.participant ?? 'Conversation'}</h1><small>BUYSELL messages</small></div></header><section className="message-thread">{messages.isLoading ? <PageLoader /> : messages.isError ? <ErrorState message={messages.error.message} /> : !messages.data?.items.length ? <EmptyState title="Start the conversation" message="Send a clear message and avoid sharing sensitive payment details." /> : messages.data.items.map((message) => <div className={`message-bubble${message.own ? ' message-bubble--own' : ''}`} key={message.id}><p>{message.body}</p><small>{message.sentAt}</small></div>)}</section><form className="message-composer" onSubmit={submit}><label className="sr-only" htmlFor="message-input">Message</label><input id="message-input" name="message" placeholder="Write a message…" autoComplete="off" /><button className="button button--primary" disabled={send.isPending}>Send</button></form></div></>;
}

export function SourcingPage() {
  const { notify } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const requests = useQuery({ queryKey: ['sourcing', 'requests'], queryFn: () => api.get<PageResult<SimpleRecord>>('/sourcing/requests'), retry: false });
  const create = useMutation({ mutationFn: (body: Record<string, FormDataEntryValue>) => api.post('/sourcing/requests', { desiredDeliveryAt: body.targetDate || undefined, notes: body.description, items: [{ title: body.productName, description: body.description, quantity: Number(body.quantity), referenceUrl: body.referenceUrl || undefined }] }), onSuccess: () => { setSubmitted(true); notify('Your sourcing request has been submitted.'); }, onError: (error) => notify(error.message, 'error') });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); create.mutate(Object.fromEntries(new FormData(event.currentTarget))); };
  return <><Seo title="Product sourcing" description="Tell BUYSELL what your business needs and receive a transparent sourcing quote." /><div className="sourcing-page"><section className="sourcing-hero"><div className="container"><span className="eyebrow eyebrow--light">Built for business buying</span><h1>Source products with less guesswork.</h1><p>Share any product reference or a clear description. Our sourcing team will review availability, prepare a transparent quote and keep you updated through fulfilment.</p><a className="button button--light" href="#request">Start a request <ArrowRight /></a></div></section><section className="sourcing-benefits container"><article><Search /><h2>Any product reference</h2><p>Paste a link from any website or describe the exact item.</p></article><article><Banknote /><h2>Clear landed quote</h2><p>Review item, service and delivery costs before deciding to proceed.</p></article><article><Truck /><h2>Visible progress</h2><p>Track review, procurement and fulfilment from your BUYSELL account.</p></article></section><section id="request" className="sourcing-request container"><div><span className="eyebrow">Tell us what you need</span><h2>Request a sourcing quote</h2><p>Include quantities, specifications and your target date. More detail helps our team quote accurately.</p><ol><li><span>1</span> We review your brief</li><li><span>2</span> You receive a quote</li><li><span>3</span> You approve and pay securely</li></ol></div>{submitted ? <div className="sourcing-success"><span><Check /></span><h2>Request received</h2><p>Our team will review it and update you in your account.</p><button className="button button--secondary" onClick={() => setSubmitted(false)}>Submit another request</button></div> : <form className="sourcing-form" onSubmit={submit}><label><span>Product name</span><input name="productName" placeholder="e.g. Custom cotton tote bags" required /></label><label><span>Reference URL <small>optional</small></span><input name="referenceUrl" type="url" inputMode="url" placeholder="https://example.com/product" /></label><div className="form-grid"><label><span>Quantity</span><input name="quantity" type="number" min="1" placeholder="500" required /></label><label><span>Target date</span><input name="targetDate" type="date" /></label></div><label><span>Specifications</span><textarea name="description" rows={5} placeholder="Size, materials, branding, colours, packaging or other requirements" required /></label><p className="form-note">You can add private reference files securely after submitting the request.</p><button className="button button--primary button--full button--large" disabled={create.isPending}>{create.isPending ? 'Submitting…' : 'Submit request'}</button><small>By submitting, you agree that the request remains subject to review and availability.</small></form>}</section>{requests.data?.items.length ? <section className="container sourcing-history"><div className="section-heading"><div><span className="eyebrow">Your requests</span><h2>Recent sourcing activity</h2></div></div><div className="data-list">{requests.data.items.map((request) => <Link to={`/seller/sourcing/${request.id}`} key={request.id}><div><strong>{request.name ?? request.primary}</strong><span>{request.secondary ?? request.quantity as string}</span></div><span className="status">{request.status}</span><strong>{request.value}</strong><ChevronRight /></Link>)}</div></section> : null}</div></>;
}

export function ServicesPage() {
  const [query, setQuery] = useState('');
  const services = useQuery({ queryKey: ['services', query], queryFn: () => api.get<PageResult<SimpleRecord>>(`/services?q=${encodeURIComponent(query)}`, { anonymous: true }) });
  return <><Seo title="Services marketplace" description="Book trusted local services through BUYSELL." /><div className="services-page container"><header className="services-hero"><div><span className="eyebrow eyebrow--light">Trusted local experts</span><h1>Book a service, without the back-and-forth.</h1><p>Discover reviewed providers, agree clear deliverables and keep bookings organised.</p><form onSubmit={(event) => event.preventDefault()}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What service do you need?" aria-label="Search services" /></form></div></header><section className="product-section"><div className="section-heading"><div><span className="eyebrow">Available near you</span><h2>Popular services</h2></div></div>{services.isLoading ? <CardSkeleton count={4} /> : services.isError ? <ErrorState message={services.error.message} onRetry={() => void services.refetch()} /> : !services.data?.items.length ? <EmptyState title="No services found" message="Try another search or check back as new providers join." /> : <div className="service-grid">{services.data.items.map((service) => <article className="service-card" key={service.id}><span className="service-card__art"><CircleHelp /></span><div><span className="status">{service.status}</span><h2>{service.name}</h2><p>{service.provider as string}</p><span><Star /> {service.rating as number} · <MapPin /> {service.location as string}</span><strong>From {formatMoney(service.price as number)}</strong><Link className="button button--secondary button--full" to={`/service/${service.id}`}>View service</Link></div></article>)}</div>}</section></div></>;
}

export function RfqPage() {
  const { notify } = useToast();
  const rfqs = useQuery({ queryKey: ['rfq'], queryFn: () => api.get<PageResult<SimpleRecord>>('/rfqs') });
  const create = useMutation({ mutationFn: (body: Record<string, FormDataEntryValue>) => api.post('/rfqs', { title: body.title, description: body.description, quantity: Number(body.quantity), responseDeadline: body.deadline, publish: true }), onSuccess: () => notify('Request for quotation published.'), onError: (error) => notify(error.message, 'error') });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); create.mutate(Object.fromEntries(new FormData(event.currentTarget))); };
  return <><Seo title="Request quotations" noIndex /><div className="container content-page"><header className="page-heading"><div><span className="eyebrow">Business procurement</span><h1>Request quotations</h1><p>Publish a clear requirement and compare responses from verified suppliers.</p></div></header><div className="split-page"><form className="settings-form" onSubmit={submit}><h2>Create a request</h2><label><span>What do you need?</span><input name="title" required /></label><div className="form-grid"><label><span>Quantity</span><input name="quantity" type="number" min="1" required /></label><label><span>Response deadline</span><input name="deadline" type="date" required /></label></div><label><span>Requirements</span><textarea name="description" rows={5} required /></label><button className="button button--primary" disabled={create.isPending}>{create.isPending ? 'Publishing…' : 'Publish request'}</button></form><section><h2>Your requests</h2>{rfqs.isLoading ? <PageLoader /> : rfqs.isError ? <ErrorState message={rfqs.error.message} /> : !rfqs.data?.items.length ? <EmptyState title="No requests yet" message="Your quotation requests will appear here." /> : <div className="data-list">{rfqs.data.items.map((rfq) => <Link to={`/rfq/${rfq.id}`} key={rfq.id}><div><strong>{rfq.name}</strong><span>{rfq.quantity as string}</span></div><span className="status">{rfq.status}</span><strong>{rfq.value}</strong><ChevronRight /></Link>)}</div>}</section></div></div></>;
}

const infoContent: Record<string, { eyebrow: string; title: string; intro: string; sections: Array<{ title: string; body: string }> }> = {
  about: { eyebrow: 'About BUYSELL', title: 'Commerce should feel dependable.', intro: 'BUYSELL brings buyers, sellers, suppliers and service providers together in a marketplace built around trust.', sections: [{ title: 'A marketplace with standards', body: 'We combine seller verification, protected payments and clear order records so every transaction has context.' }, { title: 'Built in Nigeria', body: 'Our workflows reflect local businesses, local delivery realities and the way people actually buy across Nigeria.' }, { title: 'Designed for progress', body: 'From a first purchase to a growing storefront, BUYSELL gives each participant the tools to move forward.' }] },
  'how-it-works': { eyebrow: 'Simple by design', title: 'From discovery to delivery.', intro: 'BUYSELL keeps the important parts of every transaction visible and organised.', sections: [{ title: 'Discover', body: 'Search products, compare verified stores and review clear product information.' }, { title: 'Pay securely', body: 'Checkout totals are calculated by BUYSELL and payment is confirmed before an order progresses.' }, { title: 'Stay informed', body: 'Track order events, delivery progress and support conversations from your account.' }] },
  'how-to-buy': { eyebrow: 'For buyers', title: 'Shop with more confidence.', intro: 'Find what you need, inspect the details and complete a protected checkout.', sections: [{ title: 'Choose verified listings', body: 'Look for complete descriptions, useful images, seller ratings and clear availability.' }, { title: 'Keep payment on-platform', body: 'Use BUYSELL checkout so the payment and order remain connected and supportable.' }, { title: 'Check your order', body: 'Follow delivery updates and report any issue from the relevant order.' }] },
  'how-to-sell': { eyebrow: 'For sellers', title: 'Build a storefront people trust.', intro: 'Create clear listings, fulfil orders consistently and understand your business performance.', sections: [{ title: 'Complete onboarding', body: 'Tell us about your business and complete the required verification.' }, { title: 'Publish quality listings', body: 'Use accurate titles, original images, honest stock and transparent prices.' }, { title: 'Fulfil with care', body: 'Process orders on time and keep customers informed through BUYSELL.' }] },
  'buyer-protection': { eyebrow: 'Buyer protection', title: 'Support around every eligible order.', intro: 'BUYSELL connects your payment, order and support history so issues can be reviewed fairly.', sections: [{ title: 'Protected checkout', body: 'Pay only through the approved BUYSELL checkout shown on your order.' }, { title: 'Clear evidence', body: 'Product details, messages, payment status and delivery events remain tied to the order.' }, { title: 'Timely resolution', body: 'Report an issue promptly from your order and follow the requested resolution steps.' }] },
  'seller-protection': { eyebrow: 'Seller protection', title: 'Good sellers deserve clear processes.', intro: 'Verified orders, payment status and auditable events help sellers fulfil with confidence.', sections: [{ title: 'Confirmed orders', body: 'Do not dispatch until BUYSELL shows that payment has been confirmed.' }, { title: 'Documented fulfilment', body: 'Keep inventory, messages and delivery updates accurate.' }, { title: 'Fair case review', body: 'Order context and submitted evidence guide dispute decisions.' }] },
  delivery: { eyebrow: 'Delivery', title: 'Clear movement from seller to buyer.', intro: 'Delivery options, fees and progress depend on the items, seller and destination.', sections: [{ title: 'Calculated at checkout', body: 'Choose an address to receive the available delivery option and final fee.' }, { title: 'Track progress', body: 'Order status updates reflect preparation, dispatch and delivery.' }, { title: 'Inspect promptly', body: 'Check delivered items and report an issue within the applicable protection period.' }] },
  safety: { eyebrow: 'Marketplace safety', title: 'Keep every transaction on record.', intro: 'A few practical habits help protect your account and your money.', sections: [{ title: 'Never share a password or code', body: 'BUYSELL support will never ask for your password or one-time authentication code.' }, { title: 'Use protected checkout', body: 'Do not move marketplace payments to personal bank accounts or unverified links.' }, { title: 'Report suspicious activity', body: 'Contact support with the relevant listing, order or message context.' }] },
  help: { eyebrow: 'Help centre', title: 'How can we help?', intro: 'Find answers for shopping, selling, payments, delivery and your account.', sections: [{ title: 'Orders & delivery', body: 'Track an order, understand statuses or get help with a delivery.' }, { title: 'Payments & refunds', body: 'Learn how payment confirmation and eligible refunds work.' }, { title: 'Stores & selling', body: 'Get started, manage listings and understand seller finance.' }] },
  faq: { eyebrow: 'Frequently asked questions', title: 'Quick answers to common questions.', intro: 'The essentials about using BUYSELL.', sections: [{ title: 'How do I know a seller is verified?', body: 'Verified stores display a verification mark next to the seller name.' }, { title: 'When is an order confirmed?', body: 'An order progresses after BUYSELL independently confirms the payment.' }, { title: 'Can I source an item I found elsewhere?', body: 'Yes. Submit any reference URL or a clear product brief through Product Sourcing.' }] },
  contact: { eyebrow: 'Contact us', title: 'Talk to the right team.', intro: 'For order help, use the order-specific support action. For general questions, contact our help team.', sections: [{ title: 'Customer support', body: 'Use the Help Centre or email help@buysell.ng.' }, { title: 'Business enquiries', body: 'Email partnerships@buysell.ng for marketplace partnerships.' }, { title: 'Security reports', body: 'Send responsible security reports to security@buysell.ng.' }] },
  terms: { eyebrow: 'Legal', title: 'Terms of service', intro: 'These terms govern access to and use of BUYSELL services.', sections: [{ title: 'Using the platform', body: 'Users must provide accurate information, follow applicable laws and use marketplace workflows responsibly.' }, { title: 'Orders and payments', body: 'Prices, checkout totals, order acceptance, cancellation and refunds follow the terms shown during each transaction.' }, { title: 'Account responsibilities', body: 'Keep account credentials secure and promptly report unauthorised access.' }] },
  privacy: { eyebrow: 'Legal', title: 'Privacy notice', intro: 'We collect and use information needed to provide, secure and improve BUYSELL.', sections: [{ title: 'Information we use', body: 'This can include account details, transaction records, communications, device information and verification data.' }, { title: 'Why we use it', body: 'We use information to operate transactions, prevent abuse, meet obligations and improve the service.' }, { title: 'Your choices', body: 'You can manage profile information and communication preferences from your account.' }] },
  cookies: { eyebrow: 'Legal', title: 'Cookie notice', intro: 'BUYSELL uses browser storage and similar technologies for essential functions and measured improvement.', sections: [{ title: 'Essential storage', body: 'Required for secure sessions, preferences and reliable navigation.' }, { title: 'Measurement', body: 'Where enabled, aggregated usage helps identify performance and usability problems.' }, { title: 'Your controls', body: 'Browser settings can limit storage, but essential account features may stop working.' }] },
  'refund-policy': { eyebrow: 'Policies', title: 'Refund policy', intro: 'Refund eligibility depends on payment status, fulfilment and the reason for the request.', sections: [{ title: 'Start from the order', body: 'Use the support action on the relevant order so the full transaction context is available.' }, { title: 'Review', body: 'BUYSELL may request evidence from the buyer, seller or delivery participant.' }, { title: 'Outcome', body: 'Approved refunds are returned through the supported payment process and can take provider processing time.' }] },
  'prohibited-items': { eyebrow: 'Policies', title: 'Prohibited and restricted items', intro: 'Some products and services cannot be listed because they are unsafe, unlawful or incompatible with BUYSELL.', sections: [{ title: 'Illegal or harmful goods', body: 'Listings must comply with Nigerian law and may not promote harm, fraud or illegal activity.' }, { title: 'Counterfeits and stolen goods', body: 'Sellers must have the right to sell every item and accurately represent its authenticity.' }, { title: 'Controlled categories', body: 'Certain regulated products require documented approval or may be disallowed entirely.' }] },
};

export function InfoPage({ page }: { page: string }) {
  const content = infoContent[page] ?? infoContent.help!;
  return <><Seo title={content.title} description={content.intro} /><div className={`info-page${['terms', 'privacy', 'cookies', 'refund-policy', 'prohibited-items'].includes(page) ? ' info-page--legal' : ''}`}><header><div className="container"><span className="eyebrow eyebrow--light">{content.eyebrow}</span><h1>{content.title}</h1><p>{content.intro}</p></div></header><div className="info-page__grid container"><aside><strong>BUYSELL guide</strong><span>Last reviewed 12 August 2026</span><Link to="/contact">Need more help? <ArrowRight /></Link></aside><main>{content.sections.map((section, index) => <section key={section.title}><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{section.title}</h2><p>{section.body}</p></div></section>)}</main></div></div></>;
}

export function HelpArticlePage() {
  const { articleSlug = 'help' } = useParams();
  return <InfoPage page={articleSlug in infoContent ? articleSlug : 'help'} />;
}

export function ServiceDetailPage() {
  const { serviceId = '' } = useParams();
  const service = useQuery({ queryKey: ['service', serviceId], queryFn: () => api.get<SimpleRecord>(`/services/${encodeURIComponent(serviceId)}`, { anonymous: true }) });
  return <><Seo title={service.data?.name ?? 'Service'} /><div className="container content-page">{service.isLoading ? <PageLoader /> : service.isError ? <ErrorState message={service.error.message} /> : <div className="service-detail"><section><span className="eyebrow">Trusted service provider</span><h1>{service.data?.name}</h1><p>{service.data?.description as string ?? 'Book a clear, professionally delivered service through BUYSELL.'}</p><div className="service-detail__meta"><span><Star /> {service.data?.rating as number ?? 'New'}</span><span><MapPin /> {service.data?.location as string ?? 'Nigeria'}</span></div><h2>What to expect</h2><ul><li>Clear scope before confirmation</li><li>Protected payment record</li><li>Booking status updates</li></ul></section><aside className="order-summary"><small>Starting from</small><strong>{formatMoney(service.data?.price as number)}</strong><label><span>Preferred date</span><input type="date" /></label><button className="button button--primary button--full">Request booking</button></aside></div>}</div></>;
}

export function UpcomingPage() {
  const { notify } = useToast();
  const subscribe = useMutation({ mutationFn: (email: string) => api.post('/marketing/waitlist', { email }, { anonymous: true }), onSuccess: () => notify('You’re on the list.'), onError: (error) => notify(error.message, 'error') });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); subscribe.mutate(String(form.get('email') ?? '')); };
  return <><Seo title="Coming to BUYSELL" description="Get early access to new BUYSELL marketplace experiences." /><div className="upcoming-page"><div className="container"><span className="eyebrow eyebrow--light">What’s next</span><h1>More ways to buy and grow are on the way.</h1><p>Join the update list for new marketplace categories, business tools and delivery coverage.</p><form onSubmit={submit}><label className="sr-only" htmlFor="waitlist-email">Email address</label><input id="waitlist-email" name="email" type="email" placeholder="you@example.com" required /><button className="button button--light" disabled={subscribe.isPending}>{subscribe.isPending ? 'Joining…' : 'Notify me'}</button></form></div></div></>;
}

export function NotFoundPage() {
  return <><Seo title="Page not found" noIndex /><div className="not-found container"><span>404</span><h1>We couldn’t find that page.</h1><p>The link may have changed, or the page may no longer be available.</p><div><Link className="button button--primary" to="/">Go home</Link><Link className="button button--secondary" to="/products">Browse products</Link></div></div></>;
}
