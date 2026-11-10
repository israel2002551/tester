// A WhatsApp seller's private catalog (/manage?catalog=<token>): every item the
// BUYSELL bot collected from their posts, as a small store they can search,
// with each item's photos and edit, mark sold and remove.
import { useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '../components/BrandLogo.jsx';
import { dateLabel, money } from '../lib/format.js';
import { cloudinaryImage } from '../lib/productData.js';
import { LISTING_CATEGORIES, STATE_LABELS, listingRequest } from '../lib/whatsappListings.js';
import '../styles/seller-catalog.css';

const PAGE_SIZE = 48;
const FILTERS = [
  ['all', 'All'],
  ['pending', 'In review'],
  ['live', 'Live'],
  ['sold', 'Sold'],
  ['deleted', 'Removed'],
];
const EMPTY_FILTER = {
  all: 'BUYSELL has not collected any items from you yet.',
  pending: 'Nothing is waiting for review.',
  live: 'None of your items are live yet.',
  sold: 'You have not marked anything as sold.',
  deleted: 'You have not removed anything.',
};

// Sellers search the way they write prices: "12k", "₦12,000" and "12000" all find 12000.
function searchWords(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean).map(word => {
    const short = /^₦?(\d+(?:\.\d+)?)(k|m)$/.exec(word);
    if (short) return String(Math.round(Number(short[1]) * (short[2] === 'k' ? 1_000 : 1_000_000)));
    return word.replace(/^₦/, '').replace(/(\d),(?=\d{3}\b)/g, '$1');
  });
}

function searchText(item) {
  return [item.name, item.description, item.category, item.location, item.your_price, item.price]
    .filter(part => part !== null && part !== undefined)
    .join(' ')
    .toLowerCase();
}

export default function WhatsAppCatalog({ token }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState('');

  useEffect(() => {
    document.title = 'Your items | BUYSELL Nigeria';
    let active = true;
    listingRequest({ action: 'catalog_get', catalog_token: token })
      .then(result => {
        if (!active) return;
        setItems(Array.isArray(result.items) ? result.items : []);
        setLimited(result.limited === true);
        setStatus('ready');
      })
      .catch(err => {
        if (!active) return;
        setError(err.message || 'This link is unavailable.');
        setStatus('error');
      });
    return () => { active = false; };
  }, [token]);

  const indexed = useMemo(() => items.map(item => ({ item, text: searchText(item) })), [items]);

  const counts = useMemo(() => {
    const totals = { all: 0, pending: 0, live: 0, sold: 0, deleted: 0 };
    for (const item of items) {
      totals[item.listing_state] = (totals[item.listing_state] || 0) + 1;
      if (item.listing_state !== 'deleted') totals.all += 1;
    }
    return totals;
  }, [items]);

  const results = useMemo(() => {
    const words = searchWords(query);
    return indexed
      .filter(({ item, text }) => (filter === 'all' ? item.listing_state !== 'deleted' : item.listing_state === filter)
        && words.every(word => text.includes(word)))
      .map(({ item }) => item);
  }, [indexed, query, filter]);

  useEffect(() => { setShown(PAGE_SIZE); }, [query, filter]);

  const openItem = openId ? items.find(item => item.id === openId) : null;
  const replaceItem = updated => setItems(current => current.map(item => (item.id === updated.id ? updated : item)));

  if (status === 'loading') return <CatalogFrame><p className="wa-manage-loading">Loading your items…</p></CatalogFrame>;
  if (status === 'error') return <CatalogFrame><CatalogError message={error} /></CatalogFrame>;

  const trimmedQuery = query.trim();
  return (
    <CatalogFrame>
      <div className="wa-catalog-head">
        <h1>Your items on BUYSELL</h1>
        <p className="wa-manage-copy">
          Everything BUYSELL collected from your WhatsApp posts. Tap an item to see its photos, edit it, mark it sold or remove it.
        </p>
      </div>

      <div className="wa-catalog-tools">
        <label className="wa-catalog-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            placeholder="Search by name, price or place"
            aria-label="Search your items"
            enterKeyHint="search"
          />
        </label>
        <div className="wa-catalog-filters" role="group" aria-label="Show">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label} <span>{counts[key] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="wa-catalog-count" aria-live="polite">
        {trimmedQuery
          ? `${results.length} ${results.length === 1 ? 'item matches' : 'items match'} “${trimmedQuery}”`
          : `${results.length} ${results.length === 1 ? 'item' : 'items'}`}
      </p>

      {results.length ? (
        <ul className="wa-catalog-grid">
          {results.slice(0, shown).map(item => (
            <li key={item.id}>
              <button type="button" className="wa-catalog-card" onClick={() => setOpenId(item.id)}>
                <span className="wa-catalog-photo">
                  {item.images[0]
                    ? <img src={cloudinaryImage(item.images[0], 360, { square: true })} alt="" loading="lazy" decoding="async" />
                    : <i className="fa-regular fa-image" aria-hidden="true" />}
                  <span className={`wa-state wa-state--${item.listing_state}`}>{STATE_LABELS[item.listing_state]}</span>
                  {item.images.length > 1
                    ? <span className="wa-catalog-photo-count"><i className="fa-regular fa-images" aria-hidden="true" /> {item.images.length}</span>
                    : null}
                </span>
                <span className="wa-catalog-name">{item.name}</span>
                <span className="wa-catalog-price">{money(item.your_price ?? item.price)}</span>
                <span className="wa-catalog-small">{money(item.price)} on BUYSELL · {dateLabel(item.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="wa-catalog-empty">
          {trimmedQuery
            ? <>No items match “{trimmedQuery}”. <button type="button" className="wa-catalog-text-button" onClick={() => setQuery('')}>Clear search</button></>
            : EMPTY_FILTER[filter]}
        </div>
      )}

      {results.length > shown ? (
        <button className="btn btn-outline wa-catalog-more" type="button" onClick={() => setShown(count => count + PAGE_SIZE)}>
          Show more ({results.length - shown} left)
        </button>
      ) : null}
      {limited ? <p className="wa-manage-meta">Showing your newest 1,000 items.</p> : null}

      {openItem ? <CatalogItem key={openItem.id} item={openItem} token={token} onClose={() => setOpenId('')} onChange={replaceItem} /> : null}
    </CatalogFrame>
  );
}

function itemForm(item) {
  return {
    title: item.name || '',
    price: item.your_price ?? item.price ?? '',
    category: item.category || 'other',
    location: item.location || '',
    description: item.description || '',
  };
}

function CatalogItem({ item, token, onClose, onChange }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState(() => itemForm(item));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const closed = item.listing_state === 'sold' || item.listing_state === 'deleted';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  async function send(payload, doneMessage) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await listingRequest({ action: 'catalog_update', catalog_token: token, product_id: item.id, ...payload });
      onChange(result.item);
      setForm(itemForm(result.item));
      setNotice({ text: doneMessage(result.item) });
    } catch (error) {
      setNotice({ text: error.message || 'Could not save your changes.', error: true });
    } finally {
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    send({ updates: form }, updated => (updated.listing_state === 'live' ? 'Saved. Buyers now see the new details.' : 'Saved.'));
  }

  function closeItem(mode) {
    const question = mode === 'sold'
      ? `Mark “${item.name}” as sold? It will come off the marketplace.`
      : `Remove “${item.name}” from BUYSELL? This can't be undone.`;
    if (!window.confirm(question)) return;
    send({ mode }, () => (mode === 'sold' ? 'Marked as sold and taken off the marketplace.' : 'Removed from BUYSELL.'));
  }

  const titleId = `wa-item-${item.id}`;
  return (
    <dialog
      ref={dialogRef}
      className="wa-catalog-dialog"
      aria-labelledby={titleId}
      // StrictMode opens the dialog twice in development; only a real close counts.
      onClose={() => { if (!dialogRef.current?.open) onClose(); }}
      onClick={event => { if (event.target === dialogRef.current) dialogRef.current.close(); }}
    >
      <div className="wa-catalog-dialog__body">
        <div className="wa-catalog-dialog__bar">
          <span className={`wa-state wa-state--${item.listing_state}`}>{STATE_LABELS[item.listing_state]}</span>
          <button type="button" className="wa-catalog-close" onClick={() => dialogRef.current?.close()} aria-label="Close">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div className="wa-catalog-gallery">
          {item.images.length ? item.images.map((url, index) => (
            <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" aria-label={`Open photo ${index + 1} of ${item.images.length} full size`}>
              <img src={cloudinaryImage(url, 720)} alt="" loading={index === 0 ? 'eager' : 'lazy'} decoding="async" />
            </a>
          )) : <div className="wa-catalog-gallery__empty"><i className="fa-regular fa-image" aria-hidden="true" /> No photos</div>}
        </div>
        {item.images.length > 1 ? <p className="wa-catalog-small">Swipe for all {item.images.length} photos. Tap one to open it full size.</p> : null}

        <h2 id={titleId}>{item.name}</h2>
        <p className="wa-catalog-prices">
          <span>Your price <strong>{money(item.your_price ?? item.price)}</strong></span>
          <span>Buyers see <strong>{money(item.price)}</strong></span>
        </p>
        <p className="wa-catalog-small">Added {dateLabel(item.created_at)}{item.has_video ? ' · has a video' : ''}</p>
        {item.listing_state === 'live'
          ? <a className="wa-public-link" href={`/product?id=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">View it on BUYSELL <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></a>
          : null}
        {item.listing_state === 'pending'
          ? <p className="wa-manage-copy">BUYSELL is reviewing this item before it appears publicly. You can still fix its details.</p>
          : null}
        {notice
          ? <p className={notice.error ? 'wa-manage-notice wa-catalog-notice--error' : 'wa-manage-notice'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>
          : null}

        <form className="wa-manage-form" onSubmit={save}>
          <label className="wa-manage-form__wide">Item title<input name="title" value={form.title} minLength="3" maxLength="300" onChange={update} disabled={busy || closed} required /></label>
          <label>Your price (₦)<input name="price" value={form.price} type="number" inputMode="numeric" min="1" max="100000000" step="1" onChange={update} disabled={busy || closed} required /></label>
          <label>Category
            <select name="category" value={form.category} onChange={update} disabled={busy || closed}>
              {LISTING_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="wa-manage-form__wide">Location<input name="location" value={form.location} maxLength="100" onChange={update} disabled={busy || closed} placeholder="e.g. Yaba, Lagos" /></label>
          <label className="wa-manage-form__wide">Description<textarea name="description" value={form.description} maxLength="2000" rows="5" onChange={update} disabled={busy || closed} /></label>
          {!closed ? <button className="btn btn-primary wa-manage-save" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button> : null}
        </form>

        {closed ? (
          <p className="wa-manage-meta">This item is {item.listing_state === 'sold' ? 'sold' : 'removed'}, so it can&apos;t be changed.</p>
        ) : (
          <div className="wa-manage-danger">
            <button className="btn btn-outline" type="button" disabled={busy} onClick={() => closeItem('sold')}>Mark as sold</button>
            <button className="btn btn-outline wa-delete" type="button" disabled={busy} onClick={() => closeItem('delete')}>Remove</button>
          </div>
        )}
      </div>
    </dialog>
  );
}

function CatalogFrame({ children }) {
  return (
    <main className="wa-manage-page wa-catalog">
      <header className="wa-manage-header wa-catalog-header">
        <a className="wa-manage-brand" href="/?view=shop" aria-label="BUYSELL marketplace"><BrandLogo variant="transparent" /></a>
        <a className="btn btn-outline btn-sm" href="/?view=shop"><i className="fa-solid fa-store" aria-hidden="true" /> Marketplace</a>
      </header>
      <section className="wa-catalog-shell">{children}</section>
    </main>
  );
}

function CatalogError({ message }) {
  return (
    <div className="wa-catalog-error">
      <h1>This link isn&apos;t working</h1>
      <p className="wa-manage-copy">
        {message} Post your next item in the BUYSELL WhatsApp group and the bot will reply with your current link.
      </p>
      <a className="btn btn-primary" href="/?view=shop">Go to the marketplace</a>
    </div>
  );
}
