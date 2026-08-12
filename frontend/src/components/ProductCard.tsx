import { Heart, MapPin, Plus, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../lib/format';
import type { Product } from '../lib/types';
import { useCart } from '../contexts/CartContext';
import { useToast } from '../contexts/ToastContext';

export function ProductCard({ product, compact = false }: { product: Product; compact?: boolean }) {
  const { addItem, adding } = useCart();
  const { notify } = useToast();

  const addToCart = async () => {
    try {
      await addItem(product.id, 1, product.variantId);
      notify(`${product.name} added to your cart`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not add this item', 'error');
    }
  };

  return (
    <article className={`product-card${compact ? ' product-card--compact' : ''}`}>
      <div className="product-card__media">
        <Link to={`/product/${product.slug}`} aria-label={`View ${product.name}`}>
          {product.image
            ? <img src={product.image} alt="" loading="lazy" />
            : <span className="product-card__placeholder" aria-hidden="true">BS</span>}
        </Link>
        {product.badge && <span className="product-card__badge">{product.badge}</span>}
        <button className="product-card__wish" type="button" aria-label={`Save ${product.name}`}><Heart /></button>
      </div>
      <div className="product-card__body">
        <Link className="product-card__title" to={`/product/${product.slug}`}>{product.name}</Link>
        <div className="product-card__price-row">
          <strong>{formatMoney(product.price, product.currency)}</strong>
          {product.compareAtPrice && <s>{formatMoney(product.compareAtPrice, product.currency)}</s>}
        </div>
        <div className="product-card__meta">
          {product.rating && <span><Star aria-hidden="true" /> {product.rating.toFixed(1)}</span>}
          {product.location && <span><MapPin aria-hidden="true" /> {product.location}</span>}
        </div>
        {typeof product.soldPercent === 'number' && (
          <div className="stock-meter" aria-label={`${product.soldPercent}% sold`}>
            <span style={{ width: `${product.soldPercent}%` }} />
          </div>
        )}
      </div>
      <button className="product-card__add" type="button" onClick={addToCart} disabled={adding} aria-label={`Add ${product.name} to cart`}>
        <Plus aria-hidden="true" /> <span>Add</span>
      </button>
    </article>
  );
}
