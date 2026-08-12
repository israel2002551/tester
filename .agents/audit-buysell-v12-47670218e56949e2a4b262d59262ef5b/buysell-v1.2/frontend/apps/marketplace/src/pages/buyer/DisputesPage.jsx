import { useEffect,useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';

export function DisputesPage(){
 const {disputeId}=useParams(),[rows,setRows]=useState([]),[orders,setOrders]=useState([]),[error,setError]=useState('');
 const load=()=>Promise.all([api('/disputes'),api('/orders')]).then(([d,o])=>{setRows(d);setOrders(Array.isArray(o)?o:o.items||[])}).catch(e=>setError(e.message));
 useEffect(()=>{load()},[]);const current=disputeId?rows.find(x=>x.id===disputeId):null;
 const submit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));await api('/disputes',{method:'POST',body:JSON.stringify(data)});e.currentTarget.reset();load()};
 return <div className="page-wrap"><h1>{current?'Dispute details':'Disputes'}</h1>{error&&<p className="error">{error}</p>}{current?<div className="form-card"><span className="eyebrow">{current.status}</span><h2>{current.dispute_type}</h2><p>{current.description}</p>{current.resolution_note&&<p className="notice">{current.resolution_note}</p>}</div>:<><div className="resource-table">{rows.map(d=><a className="resource-row" key={d.id} href={`/disputes/${d.id}`}><strong>{d.dispute_type}</strong><span>{d.status}</span><small>{new Date(d.created_at).toLocaleDateString()}</small></a>)}</div><form className="form-card stack section-gap" onSubmit={submit}><h2>Open a dispute</h2><select name="order_id" required><option value="">Choose order</option>{orders.map(o=><option key={o.id} value={o.id}>{o.order_number||o.id} · {o.status}</option>)}</select><select name="dispute_type" required><option value="item_not_received">Item not received</option><option value="item_not_as_described">Item not as described</option><option value="payment_issue">Payment issue</option><option value="other">Other</option></select><textarea name="description" placeholder="Describe the issue and what resolution you need" required/><button className="button">Submit dispute</button></form></>}</div>
}
