import { useEffect,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

export function MessagesPage(){
  const {conversationId}=useParams();
  const {user}=useAuth();
  const [conversations,setConversations]=useState([]),[messages,setMessages]=useState([]),[error,setError]=useState('');
  useEffect(()=>{api('/messages').then(setConversations).catch(e=>setError(e.message))},[]);
  useEffect(()=>{if(conversationId)api(`/messages/${conversationId}`).then(setMessages).catch(e=>setError(e.message));else setMessages([])},[conversationId]);
  const send=async e=>{e.preventDefault();const content=e.currentTarget.message.value.trim();if(!content)return;const created=await api(`/messages/${conversationId}`,{method:'POST',body:JSON.stringify({content})});setMessages(x=>[...x,created]);e.currentTarget.reset()};
  return <div className="page-wrap"><h1>Messages</h1><div className="messages-layout"><aside className="conversation-list">{conversations.length?conversations.map(c=>{const p=c.participants?.[0]||{};return <Link key={c.id} className={conversationId===c.id?'conversation active':'conversation'} to={`/messages/${c.id}`}><strong>{p.store_name||p.name||'Marketplace conversation'}</strong><span>{c.last_message?.content||c.last_message?.message||'Start the conversation'}</span>{c.unread_count>0&&<b>{c.unread_count}</b>}</Link>}):<div className="empty-panel small-empty">No conversations yet.</div>}</aside><section className="chat-panel">{error&&<p className="error">{error}</p>}{conversationId?<><div className="chat-messages">{messages.map(m=><div key={m.id} className={m.sender_id===user.id?'bubble mine':'bubble'}><strong>{m.sender_id===user.id?'You':m.sender_name||'Seller'}</strong><p>{m.content||m.message||m.body}</p><small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div><form className="message-form" onSubmit={send}><input name="message" placeholder="Write a message…" autoComplete="off"/><button className="button">Send</button></form></>:<div className="empty-panel">Choose a conversation.</div>}</section></div></div>
}
