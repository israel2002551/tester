import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useCart } from '../../state/CartContext.jsx';

export function CollectionPage({ type }) {
  const [items,setItems]=useState([]), [error,setError]=useState('');
  const cart=useCart();
  const title=type==='compare'?'Compare products':'Wishlist';
  const load=()=>api(`/collections/${type}`).then(setItems).catch(e=>setError(e.message));
  useEffect(()=>{load()},[type]);
  const remove=async id=>{await api(`/collections/${type}/${id}`,{method:'DELETE'});setItems(x=>x.filter(p=>p.id!==id))};
  return <div className="page-wrap"><div className="page-title-row"><div><h1>{title}</h1><p className="muted">Saved to your BUYSELL account and synced across devices.</p></div></div>{error&&<p className="error">{error}</p>}{items.length?<div className={type==='compare'?'compare-grid':'product-grid'}>{items.map(p=><article className="product-card" key={p.id}><Link to={`/products/${p.id}`}><div className="product-media">{p.image_url?<img src={p.image_url} alt={p.name}/>:<div className="placeholder">BUYSELL</div>}</div><h3>{p.name}</h3><p className="muted">{p.store_name||p.seller_name||'Seller'}</p><strong>₦{(Number(p.flash_price||p.price)/100).toLocaleString()}</strong>{type==='compare'&&<dl className="compare-specs"><div><dt>Condition</dt><dd>{p.condition||'—'}</dd></div><div><dt>Location</dt><dd>{p.location||'—'}</dd></div><div><dt>Stock</dt><dd>{p.stock_quantity}</dd></div><div><dt>Rating</dt><dd>{Number(p.average_rating||0).toFixed(1)}</dd></div></dl>}</Link><div className="card-actions"><button className="button secondary" onClick={()=>cart.add(p)}>Add to cart</button><button className="text-btn danger-text" onClick={()=>remove(p.id)}>Remove</button></div></article>)}</div>:<div className="empty-panel">No {type==='compare'?'products selected for comparison':'saved products'} yet.</div>}</div>
}
