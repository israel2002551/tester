import { Facebook, Instagram, Linkedin, Mail, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from './Brand';

export function MarketplaceFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid container">
        <div className="site-footer__about">
          <Brand inverse />
          <p>Nigeria’s dependable marketplace for quality products, protected payments and verified businesses.</p>
          <div className="social-links"><a href="https://instagram.com" aria-label="BUYSELL on Instagram"><Instagram /></a><a href="https://facebook.com" aria-label="BUYSELL on Facebook"><Facebook /></a><a href="https://linkedin.com" aria-label="BUYSELL on LinkedIn"><Linkedin /></a></div>
        </div>
        <div><h2>Shop</h2><Link to="/products">All products</Link><Link to="/category/electronics">Electronics</Link><Link to="/category/fashion">Fashion</Link><Link to="/services">Services</Link></div>
        <div><h2>Sell</h2><Link to="/signup/seller">Open a store</Link><Link to="/seller/dashboard">Seller centre</Link><Link to="/seller/sourcing">Product sourcing</Link><Link to="/supplier/dashboard">Supplier portal</Link></div>
        <div><h2>Support</h2><Link to="/buyer-protection">Buyer protection</Link><Link to="/delivery">Delivery</Link><Link to="/safety">Safety</Link><Link to="/help">Help centre</Link></div>
        <div><h2>Contact</h2><span><Mail /> hello@buysell.ng</span><span><Phone /> +234 700 BUYSELL</span><span><MapPin /> Lagos, Nigeria</span></div>
      </div>
      <div className="site-footer__bottom container"><span>© {new Date().getFullYear()} BUYSELL Technologies. All rights reserved.</span><div><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/cookies">Cookies</Link></div></div>
    </footer>
  );
}
