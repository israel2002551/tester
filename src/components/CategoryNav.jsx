import { categoryIcon, categoryLinks } from '../lib/categoryData.js';

export default function CategoryNav({ active, customLabel = '', counts = {} }) {
  const label = (text, key) => (
    <>
      <i className={`fa-solid ${categoryIcon(key)}`} aria-hidden="true" />
      <span>{text}</span>
      {Number.isFinite(counts[key]) ? <small>{counts[key].toLocaleString('en-NG')}</small> : null}
    </>
  );
  return (
    <nav className="category-nav" aria-label="Product categories">
      {customLabel ? (
        <a href={`/products?category=${encodeURIComponent(active)}`} className="active" aria-current="page">
          {label(customLabel, active)}
        </a>
      ) : null}
      {categoryLinks.map(([text, href, key]) => (
        <a href={href} data-category-nav={key} className={active === key ? 'active' : ''} aria-current={active === key ? 'page' : undefined} key={key}>
          {label(text, key)}
        </a>
      ))}
    </nav>
  );
}
