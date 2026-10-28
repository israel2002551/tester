const benefits = [
  ['fa-truck-fast', '₦2,500 flat delivery', 'One fee per order, any number of stores'],
  ['fa-location-dot', 'Free Safe Hub pickup', 'Collect from a verified hub near you'],
  ['fa-shield-halved', 'Verified payments', 'You pay BUYSELL; an admin checks it'],
  ['fa-comments', 'Seller chat', 'Ask questions before you buy'],
];

export default function CategoryTrustBar() {
  return (
    <section className="category-trust-bar" aria-label="BUYSELL shopping benefits">
      {benefits.map(([icon, title, text]) => (
        <div key={title}>
          <i className={`fa-solid ${icon}`} aria-hidden="true" />
          <strong>{title}</strong>
          <span>{text}</span>
        </div>
      ))}
    </section>
  );
}
