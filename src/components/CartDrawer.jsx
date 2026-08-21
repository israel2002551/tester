import { useState, useEffect } from 'react';
import { readJson, writeJson } from '../lib/storage.js';
import { money } from '../lib/format.js';

export default function CartDrawer({ isOpen, onClose, onCartChange }) {
  const [items, setItems] = useState([]);

  const syncCart = () => {
    const data = readJson('bs_cart', []);
    setItems(data);
    if (onCartChange) {
      const totalCount = data.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
      onCartChange(totalCount);
    }
  };

  useEffect(() => {
    if (isOpen) {
      syncCart();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const changeQty = (id, delta) => {
    const updated = items
      .map(item => {
        if (item.id === id) {
          const newQty = (Number(item.qty) || 1) + delta;
          return newQty > 0 ? { ...item, qty: newQty } : null;
        }
        return item;
      })
      .filter(Boolean);
    writeJson('bs_cart', updated);
    setItems(updated);
    if (onCartChange) {
      const totalCount = updated.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
      onCartChange(totalCount);
    }
  };

  const removeItem = id => {
    const updated = items.filter(item => item.id !== id);
    writeJson('bs_cart', updated);
    setItems(updated);
    if (onCartChange) {
      const totalCount = updated.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
      onCartChange(totalCount);
    }
  };

  const productTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.qty) || 1), 0);
  const sellerIds = new Set(items.map(item => item.seller_id).filter(Boolean));
  const sellerCount = Math.max(1, sellerIds.size);
  const shippingTotal = items.length ? sellerCount * 1200 : 0;
  const total = productTotal + shippingTotal;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          height: '100%',
          backgroundColor: '#fff',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
          animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-subtle, #f9fafb)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <i className="fa-solid fa-cart-shopping" style={{ color: 'var(--green, #16a34a)', fontSize: '1.25rem' }} />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: '#111827' }}>
              Your Shopping Cart ({items.reduce((s, i) => s + (Number(i.qty) || 1), 0)})
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.2rem',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '0.4rem',
              borderRadius: '6px',
            }}
            title="Close cart"
            type="button"
          >
            <i className="fa-solid fa-times" />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' }}>
              <i className="fa-solid fa-cart-arrow-down" style={{ fontSize: '3.5rem', color: '#d1d5db', marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#374151', margin: '0 0 0.5rem 0' }}>Your cart is empty</h3>
              <p style={{ fontSize: '0.9rem', margin: 0 }}>Add products to your cart to start shopping.</p>
              <button
                className="btn btn-primary btn-sm"
                onClick={onClose}
                style={{ marginTop: '1.25rem' }}
                type="button"
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {items.map(item => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    gap: '0.9rem',
                    padding: '0.85rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    backgroundColor: '#fff',
                    alignItems: 'center',
                  }}
                >
                  <img
                    src={item.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200'}
                    alt={item.name || 'Product'}
                    style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4
                      style={{
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        margin: '0 0 0.25rem 0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: '#1f2937',
                      }}
                    >
                      {item.name}
                    </h4>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--green, #16a34a)' }}>
                      {money(item.price)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem' }}>
                      <button
                        onClick={() => changeQty(item.id, -1)}
                        className="btn btn-outline btn-sm"
                        style={{ padding: '0.15rem 0.5rem', height: '26px', minWidth: '26px' }}
                        type="button"
                      >
                        -
                      </button>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, minWidth: '20px', textAlign: 'center' }}>
                        {item.qty || 1}
                      </span>
                      <button
                        onClick={() => changeQty(item.id, 1)}
                        className="btn btn-outline btn-sm"
                        style={{ padding: '0.15rem 0.5rem', height: '26px', minWidth: '26px' }}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#111827' }}>
                      {money(Number(item.price || 0) * (Number(item.qty) || 1))}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.3rem 0.6rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                      title="Remove item"
                      type="button"
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Summary */}
        {items.length > 0 && (
          <div
            style={{
              padding: '1.25rem',
              borderTop: '1px solid #e5e7eb',
              background: 'var(--surface-subtle, #f9fafb)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#4b5563' }}>
              <span>Items Total:</span>
              <span style={{ fontWeight: 600, color: '#111827' }}>{money(productTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#4b5563' }}>
              <span>BUYSELL Delivery ({sellerCount} {sellerCount === 1 ? 'store' : 'stores'}):</span>
              <span style={{ fontWeight: 600, color: '#111827' }}>{money(shippingTotal)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '1.15rem',
                fontWeight: 800,
                color: '#111827',
                borderTop: '1px dashed #d1d5db',
                paddingTop: '0.75rem',
              }}
            >
              <span>Total:</span>
              <span style={{ color: 'var(--green, #16a34a)' }}>{money(total)}</span>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 700, marginTop: '0.25rem' }}
              onClick={() => {
                window.location.href = '/?view=shop&checkout=open';
              }}
              type="button"
            >
              <i className="fa-solid fa-lock" /> Proceed to Checkout
            </button>
            <button
              className="btn btn-outline"
              style={{ width: '100%', padding: '0.6rem' }}
              onClick={onClose}
              type="button"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
