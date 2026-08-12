import { Heart, MapPin, Menu, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { Brand } from './Brand';

export function MarketplaceHeader() {
  const navigate = useNavigate();
  const { cart } = useCart();
  const { authUser } = useAuth();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (value) navigate(`/search?q=${encodeURIComponent(value)}`);
  };

  return (
    <header className="site-header">
      <div className="announcement">
        <span>Secure payments. Verified sellers. Nationwide delivery.</span>
        <Link to="/help">Get help</Link>
      </div>
      <div className="site-header__main container">
        <button className="icon-button site-header__menu" type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu /></button>
        <Brand />
        <form className="market-search" role="search" onSubmit={search}>
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor="global-search">Search products, brands and stores</label>
          <input id="global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, brands and stores" autoComplete="off" />
          <button type="submit">Search</button>
        </form>
        <nav className="site-header__actions" aria-label="Quick actions">
          <Link className="header-action" to="/wishlist"><Heart /><span>Wishlist</span></Link>
          <Link className="header-action" to={authUser ? '/account' : '/login'}><UserRound /><span>{authUser ? 'Account' : 'Sign in'}</span></Link>
          <Link className="header-action header-action--cart" to="/cart"><ShoppingBag /><span>Cart</span>{cart.itemCount > 0 && <b>{cart.itemCount}</b>}</Link>
        </nav>
      </div>
      <div className="site-header__nav-wrap">
        <nav className="site-header__nav container" aria-label="Marketplace">
          <NavLink to="/products">All products</NavLink>
          <NavLink to="/category/electronics">Electronics</NavLink>
          <NavLink to="/category/fashion">Fashion</NavLink>
          <NavLink to="/category/home-living">Home & living</NavLink>
          <NavLink to="/category/beauty">Beauty</NavLink>
          <NavLink to="/services">Services</NavLink>
          <NavLink to="/sourcing">Product sourcing</NavLink>
          <NavLink className="site-header__sell" to="/signup/seller">Start selling</NavLink>
        </nav>
      </div>
      <div className="delivery-strip container"><MapPin aria-hidden="true" /> Delivering to <strong>Lekki Phase 1, Lagos</strong></div>

      {menuOpen && (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button className="mobile-drawer__backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="mobile-drawer__panel">
            <div className="mobile-drawer__head"><Brand /><button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X /></button></div>
            <nav onClick={() => setMenuOpen(false)}>
              <NavLink to="/products">Marketplace</NavLink>
              <NavLink to="/category/electronics">Electronics</NavLink>
              <NavLink to="/category/fashion">Fashion</NavLink>
              <NavLink to="/category/home-living">Home & living</NavLink>
              <NavLink to="/services">Services</NavLink>
              <NavLink to="/sourcing">Product sourcing</NavLink>
              <NavLink to="/seller/dashboard">Seller centre</NavLink>
              <NavLink to="/help">Help centre</NavLink>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
