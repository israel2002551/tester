import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

export function UpcomingPage() {
  const [items,setItems]=useState([]),[error,setError]=useState('');
  useEffect(()=>{api('/upcoming').then(d=>setItems(d.items||[])).catch(e=>setError(e.message));},[]);
  return <main className="page-wrap">
    <div className="page-title-row"><div><p className="eyebrow">Coming to BUYSELL</p><h1>Upcoming products</h1><p className="muted">Products and launches announced by the marketplace team.</p></div></div>
    {error&&<p className="error">{error}</p>}
    <div className="product-grid section-gap">
      {items.map(item=><article className="product-card" key={item.id}>
        <div className="product-media">{item.image_url?<img src={item.image_url} alt={item.title}/>:<div className="placeholder">Coming soon</div>}</div>
        <p className="eyebrow">{item.launch_date?new Date(item.launch_date).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}):'Launch date TBA'}</p>
        <h3>{item.title}</h3><p className="muted">{item.description||'More details will be announced soon.'}</p>
      </article>)}
      {!items.length&&!error&&<div className="empty-panel full-span">No upcoming product announcements yet.</div>}
    </div>
  </main>;
}
