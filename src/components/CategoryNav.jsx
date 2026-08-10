import { categoryLinks } from '../lib/categoryData.js';

export default function CategoryNav({ active }) {
  return (
    <nav className="category-nav">
      {categoryLinks.map(([label, href, key]) => (
        <a href={href} data-category-nav={key} className={active === key ? 'active' : ''} key={key}>
          {label}
        </a>
      ))}
    </nav>
  );
}
