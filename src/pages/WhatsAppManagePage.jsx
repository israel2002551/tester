import { useEffect, useMemo, useState } from 'react';
import BrandLogo from '../components/BrandLogo.jsx';
import { ensureRuntimeConfig, runtimeConfig } from '../lib/browserConfig.js';
import { money } from '../lib/format.js';

async function listingRequest(payload) {
  await ensureRuntimeConfig();
  const config = runtimeConfig();
  const url = String(config.SB_URL || '').replace(/\/+$/, '');
  const key = String(config.SB_KEY || '');
  if (!url || !key) throw new Error('Marketplace configuration is unavailable.');
  const response = await fetch(`${url}/functions/v1/whatsapp-listing-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not manage this listing.');
  return data;
}

function formFor(product = {}) {
  return {
    title: product.name || '',
    price: product.price ?? '',
    description: product.description || '',
    location: product.location || '',
    category: product.category || 'other',
    condition: product.condition || 'used-good',
  };
}

export default function WhatsAppManagePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const productId = params.get('product') || '';
  const token = params.get('token') || '';
  const [listing, setListing] = useState(null);
  const [form, setForm] = useState({});
  const [status, setStatus] = useState('loading');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Manage WhatsApp Listing | BUYSELL Nigeria';
    let active = true;
    if (!productId || !token) {
      setStatus('missing');
      return () => { active = false; };
    }
    listingRequest({ action: 'manage_get', product_id: productId, manage_token: token })
      .then(result => {
        if (!active) return;
        setListing(result);
        setForm(formFor(result.product));
        setStatus('ready');
      })
      .catch(error => {
        if (!active) return;
        setNotice(error.message || 'This management link is unavailable.');
        setStatus('error');
      });
    return () => { active = false; };
  }, [productId, token]);

  const product = listing?.product || {};
  const closed = ['sold', 'deleted'].includes(listing?.listing_state);
  const updateForm = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await listingRequest({
        action: 'manage_update',
        product_id: productId,
        manage_token: token,
        updates: form,
      });
      setListing(result);
      setForm(formFor(result.product));
      setNotice('Your changes were saved. BUYSELL will review the updated listing.');
    } catch (error) {
      setNotice(error.message || 'Could not save your changes.');
    } finally {
      setBusy(false);
    }
  }

  async function closeListing(mode) {
    const label = mode === 'sold' ? 'mark this item as sold' : 'remove this listing';
    if (!window.confirm(`Are you sure you want to ${label}?`)) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await listingRequest({
        action: 'manage_update',
        product_id: productId,
        manage_token: token,
        mode,
      });
      setListing(result);
      setNotice(mode === 'sold' ? 'Marked as sold and removed from the marketplace.' : 'Listing removed from the marketplace.');
    } catch (error) {
      setNotice(error.message || 'Could not update this listing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wa-manage-page">
      <header className="wa-manage-header">
        <a className="wa-manage-brand" href="/?view=shop" aria-label="BUYSELL marketplace"><BrandLogo variant="transparent" /></a>
        <a className="btn btn-outline btn-sm" href="/?view=shop"><i className="fa-solid fa-store" /> Marketplace</a>
      </header>
      <section className="wa-manage-card">
        {status === 'loading' ? <p className="wa-manage-loading">Loading your listing…</p> : null}
        {status === 'missing' ? <ManageError message="This management link is incomplete." /> : null}
        {status === 'error' ? <ManageError message={notice || 'This management link is unavailable.'} /> : null}
        {status === 'ready' ? (
          <>
            <span className={`wa-state wa-state--${listing.listing_state}`}>{listing.listing_state === 'live' ? 'Live' : listing.listing_state}</span>
            <h1>Manage your WhatsApp listing</h1>
            <p className="wa-manage-copy">
              {listing.listing_state === 'pending'
                ? 'Your post is in BUYSELL review. You can correct its details while we review it.'
                : listing.listing_state === 'live'
                  ? 'Your listing is live on BUYSELL. Keep these details accurate for buyers.'
                  : 'This listing is closed and can no longer be changed.'}
            </p>
            {notice ? <p className="wa-manage-notice" role="status">{notice}</p> : null}
            {listing.listing_state === 'live' ? <a className="wa-public-link" href={`/product?id=${encodeURIComponent(product.id)}`}>View public listing <i className="fa-solid fa-arrow-up-right-from-square" /></a> : null}
            <form onSubmit={submit} className="wa-manage-form">
              <label>Item title<input name="title" value={form.title || ''} minLength="3" maxLength="300" onChange={updateForm} disabled={busy || closed} required /></label>
              <label>Price (₦)<input name="price" value={form.price ?? ''} type="number" min="1" max="100000000" step="1" onChange={updateForm} disabled={busy || closed} required /></label>
              <label>Category
                <select name="category" value={form.category || 'other'} onChange={updateForm} disabled={busy || closed}>
                  <option value="phones">Phones &amp; tablets</option><option value="electronics">Electronics &amp; computers</option><option value="fashion">Fashion</option><option value="home">Home &amp; furniture</option><option value="beauty">Beauty &amp; health</option><option value="sports">Sports</option><option value="dropship">Dropship</option><option value="other">Other</option>
                </select>
              </label>
              <label>Condition
                <select name="condition" value={form.condition || 'used-good'} onChange={updateForm} disabled={busy || closed}>
                  <option value="new">New</option><option value="used-like-new">Foreign used / like new</option><option value="used-good">Used</option>
                </select>
              </label>
              <label className="wa-manage-form__wide">Location<input name="location" value={form.location || ''} maxLength="100" onChange={updateForm} disabled={busy || closed} placeholder="e.g. Yaba, Lagos" /></label>
              <label className="wa-manage-form__wide">Description<textarea name="description" value={form.description || ''} maxLength="2000" rows="6" onChange={updateForm} disabled={busy || closed} /></label>
              {!closed ? <button className="btn btn-primary wa-manage-save" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save changes'}</button> : null}
            </form>
            {!closed ? <div className="wa-manage-danger"><button className="btn btn-outline" disabled={busy} type="button" onClick={() => closeListing('sold')}>Mark as sold</button><button className="btn btn-outline wa-delete" disabled={busy} type="button" onClick={() => closeListing('delete')}>Remove listing</button></div> : null}
            <p className="wa-manage-meta">Current asking price: {money(product.price)}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}

function ManageError({ message }) {
  return <><h1>Listing unavailable</h1><p className="wa-manage-copy">{message}</p><a className="btn btn-primary" href="/?view=shop">Return to marketplace</a></>;
}
