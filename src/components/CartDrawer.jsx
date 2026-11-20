import { useEffect, useRef, useState } from 'react';
import { normalizeCart, normalizeCartItem } from '../lib/cart.js';
import { readJson, writeCheckoutCartHandoff, writeJson } from '../lib/storage.js';
import { money } from '../lib/format.js';
import { choiceSummary, missingChoices } from '../lib/productChoices.js';

function cartQuantity(items) {
  return normalizeCart(items).reduce((sum, item) => sum + item.qty, 0);
}

export default function CartDrawer({ isOpen, onClose, onCartChange }) {
  const [items, setItems] = useState([]);
  const closeButtonRef = useRef(null);

  const notifyCartChange = nextItems => {
    onCartChange?.(cartQuantity(nextItems));
    window.dispatchEvent(new Event('bs:cart-change'));
  };

  const syncCart = () => {
    const nextItems = normalizeCart(readJson('bs_cart', []));
    writeJson('bs_cart', nextItems);
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

  const changeQty = (lineKey, delta) => {
    const updated = items
      .map(item => {
        if (item.line_key !== lineKey) return item;
        const nextQuantity = item.qty + delta;
        return nextQuantity > 0 ? normalizeCartItem({ ...item, qty: nextQuantity }) : null;
      })
      .filter(Boolean);
    const normalized = normalizeCart(updated);
    writeJson('bs_cart', normalized);
    setItems(normalized);
    notifyCartChange(normalized);
  };

  const removeItem = lineKey => {
    const updated = items.filter(item => item.line_key !== lineKey);
    writeJson('bs_cart', updated);
    setItems(updated);
    notifyCartChange(updated);
  };

  // The cart shows the items' subtotal only; checkout shows the amount to pay.
  const productTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.qty) || 1), 0);
  const quantity = cartQuantity(items);
  // Lines added before sizes and photo choices existed may still need them.
  const incomplete = items.filter(item => missingChoices(item).length);
  const proceedToCheckout = () => {
    if (incomplete.length) return;
    // Checkout loads the classic marketplace in a new document. Persist both
    // durable and session-scoped copies before closing this React drawer.
    const normalized = normalizeCart(items);
    writeJson('bs_cart', normalized);
    writeCheckoutCartHandoff(normalized);
    // On in-app product navigation, app.js remains alive and otherwise keeps
    // its earlier empty cart array. Bring that legacy checkout state forward.
    window.syncCartFromStorage?.(normalized);
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
                <li className="cart-drawer__item" key={item.line_key}>
                  <img src={item.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200'} alt="" />
                  <div className="cart-drawer__item-main">
                    <h3>{item.name || 'Product'}</h3>
                    <p>{money(item.price)} each</p>
                    {choiceSummary(item.choices) ? <p className="cart-drawer__choices">{choiceSummary(item.choices)}</p> : null}
                    {missingChoices(item).length ? (
                      <a className="cart-drawer__choose" href={`/product.html?id=${encodeURIComponent(item.id)}`}>
                        <i className="fa-solid fa-circle-exclamation" /> Choose your {missingChoices(item).map(part => (part === 'size' ? 'size' : 'option')).join(' and ')}
                      </a>
                    ) : null}
                    <div className="cart-drawer__quantity" aria-label={`Quantity for ${item.name || 'product'}`}>
                      <button onClick={() => changeQty(item.line_key, -1)} aria-label={`Decrease quantity of ${item.name || 'product'}`} type="button"><i className="fa-solid fa-minus" /></button>
                      <strong aria-live="polite">{item.qty || 1}</strong>
                      <button onClick={() => changeQty(item.line_key, 1)} aria-label={`Increase quantity of ${item.name || 'product'}`} type="button"><i className="fa-solid fa-plus" /></button>
                    </div>
                  </div>
                  <div className="cart-drawer__item-total">
                    <strong>{money(Number(item.price || 0) * (Number(item.qty) || 1))}</strong>
                    <button onClick={() => removeItem(item.line_key)} aria-label={`Remove ${item.name || 'product'} from cart`} type="button"><i className="fa-solid fa-trash-can" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 ? (
          <footer className="cart-drawer__footer">
            <dl className="cart-drawer__summary">
              <div className="cart-drawer__grand-total"><dt>Subtotal</dt><dd>{money(productTotal)}</dd></div>
            </dl>
            {incomplete.length ? (
              <p className="cart-drawer__notice" role="alert">
                <i className="fa-solid fa-circle-exclamation" /> Choose a size or option for {incomplete.length === 1 ? 'one item' : `${incomplete.length} items`} before checkout.
              </p>
            ) : null}
            <button
              className="btn btn-primary cart-drawer__checkout"
              onClick={proceedToCheckout}
              disabled={Boolean(incomplete.length)}
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
