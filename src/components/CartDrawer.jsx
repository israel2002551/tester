import { useEffect, useRef, useState } from 'react';
import { readJson, writeJson } from '../lib/storage.js';
import { money } from '../lib/format.js';

function cartQuantity(items) {
  return items.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
}

export default function CartDrawer({ isOpen, onClose, onCartChange }) {
  const [items, setItems] = useState([]);
  const closeButtonRef = useRef(null);

  const notifyCartChange = nextItems => {
    onCartChange?.(cartQuantity(nextItems));
    window.dispatchEvent(new Event('bs:cart-change'));
  };

  const syncCart = () => {
    const nextItems = readJson('bs_cart', []);
    setItems(nextItems);
    notifyCartChange(nextItems);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    syncCart();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const changeQty = (id, delta) => {
    const updated = items
      .map(item => {
        if (item.id !== id) return item;
        const nextQuantity = (Number(item.qty) || 1) + delta;
        return nextQuantity > 0 ? { ...item, qty: nextQuantity } : null;
      })
      .filter(Boolean);
    writeJson('bs_cart', updated);
    setItems(updated);
    notifyCartChange(updated);
  };

  const removeItem = id => {
    const updated = items.filter(item => item.id !== id);
    writeJson('bs_cart', updated);
    setItems(updated);
    notifyCartChange(updated);
  };

  const productTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.qty) || 1), 0);
  const sellerIds = new Set(items.map(item => item.seller_id).filter(Boolean));
  const sellerCount = Math.max(1, sellerIds.size);
  const shippingTotal = items.length ? sellerCount * 2500 : 0;
  const total = productTotal + shippingTotal;
  const quantity = cartQuantity(items);
  const proceedToCheckout = () => {
    onClose?.();
    // When this drawer was opened from the marketplace shell, preserve its
    // authenticated runtime rather than forcing a full page reload.
    if (typeof window.bsNavigate === 'function') {
      window.bsNavigate('/?view=shop&page=checkout');
      return;
    }
    window.location.assign('/?view=shop&page=checkout');
  };

  return (
    <div className="cart-drawer-backdrop" onClick={event => event.target === event.currentTarget && onClose()}>
      <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title">
        <header className="cart-drawer__header">
          <div>
            <span className="cart-drawer__eyebrow"><i className="fa-solid fa-bag-shopping" /> Your order</span>
            <h2 id="cart-drawer-title">Cart <span>{quantity}</span></h2>
          </div>
          <button ref={closeButtonRef} className="cart-drawer__close" onClick={onClose} title="Close cart" aria-label="Close cart" type="button">
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className="cart-drawer__body">
          {items.length === 0 ? (
            <div className="cart-drawer__empty">
              <span className="cart-drawer__empty-icon"><i className="fa-solid fa-bag-shopping" /></span>
              <h3>Your cart is waiting for something good.</h3>
              <p>Browse categories or return to the marketplace to add products.</p>
              <button className="btn btn-primary" onClick={onClose} type="button">Continue shopping <i className="fa-solid fa-arrow-right" /></button>
            </div>
          ) : (
            <ul className="cart-drawer__items">
              {items.map(item => (
                <li className="cart-drawer__item" key={item.id}>
                  <img src={item.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200'} alt="" />
                  <div className="cart-drawer__item-main">
                    <h3>{item.name || 'Product'}</h3>
                    <p>{money(item.price)} each</p>
                    <div className="cart-drawer__quantity" aria-label={`Quantity for ${item.name || 'product'}`}>
                      <button onClick={() => changeQty(item.id, -1)} aria-label={`Decrease quantity of ${item.name || 'product'}`} type="button"><i className="fa-solid fa-minus" /></button>
                      <strong aria-live="polite">{item.qty || 1}</strong>
                      <button onClick={() => changeQty(item.id, 1)} aria-label={`Increase quantity of ${item.name || 'product'}`} type="button"><i className="fa-solid fa-plus" /></button>
                    </div>
                  </div>
                  <div className="cart-drawer__item-total">
                    <strong>{money(Number(item.price || 0) * (Number(item.qty) || 1))}</strong>
                    <button onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name || 'product'} from cart`} type="button"><i className="fa-solid fa-trash-can" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 ? (
          <footer className="cart-drawer__footer">
            <dl className="cart-drawer__summary">
              <div><dt>Items subtotal</dt><dd>{money(productTotal)}</dd></div>
              <div><dt>BUYSELL delivery · {sellerCount} {sellerCount === 1 ? 'store' : 'stores'}</dt><dd>{money(shippingTotal)}</dd></div>
              <div className="cart-drawer__grand-total"><dt>Total</dt><dd>{money(total)}</dd></div>
            </dl>
            <button
              className="btn btn-primary cart-drawer__checkout"
              onClick={proceedToCheckout}
              type="button"
            >
              <i className="fa-solid fa-lock" /> Proceed to checkout
            </button>
            <button className="cart-drawer__continue" onClick={onClose} type="button">Continue shopping</button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
