import{useEffect,useState}from'react';
import{Link,useParams,useSearchParams}from'react-router-dom';
import{api}from'../../api/client.js';
import{useCart}from'../../state/CartContext.jsx';
const cats=['trending','electronics','phones','fashion','beauty','home','sports','dropship'];
export function ShopPage(){
 const{slug}=useParams();const[params,setParams]=useSearchParams(),[products,setProducts]=useState([]),[loading,setLoading]=useState(true),cart=useCart();
 const q=params.get('q')||'',category=slug||params.get('category')||'';
 useEffect(()=>{setLoading(true);api(`/products?limit=60${q?`&q=${encodeURIComponent(q)}`:''}${category&&category!=='trending'?`&category=${encodeURIComponent(category)}`:''}`).then(d=>setProducts(d.items||[])).finally(()=>setLoading(false));},[q,category]);
 return <div className="page-wrap"><section className="hero"><div><span className="eyebrow">BUYSELL NIGERIA</span><h1>One marketplace. Every kind of buyer and seller.</h1><p>Browse verified listings, chat with merchants, pay securely and track orders from one account.</p></div><form onSubmit={e=>{e.preventDefault();setParams({...(category&&category!=='trending'?{category}:{}),q:e.currentTarget.q.value})}}><input name="q" defaultValue={q} placeholder="Search products, brands…"/><button className="button">Search</button></form></section><div className="chips">{cats.map(c=><Link key={c} className={category===c||(!category&&c==='trending')?'chip active':'chip'} to={c==='trending'?'/shop':`/category/${c}`}>{c}</Link>)}</div>{loading?<p>Loading products…</p>:products.length?<div className="product-grid">{products.map(p=><article className="product-card" key={p.id}><Link to={`/products/${p.id}`}><div className="product-media">{p.image_url?<img src={p.image_url} alt={p.name}/>:<div className="placeholder">BUYSELL</div>}</div><h3>{p.name}</h3><p className="muted">{p.store_name||p.seller_name||'Verified seller'}</p><strong>₦{(Number(p.flash_price||p.price)/100).toLocaleString()}</strong></Link><button className="button secondary" onClick={()=>cart.add(p)}>Add to cart</button></article>)}</div>:<div className="empty-panel">No products match this view yet.</div>}</div>
}
