const benefits = [
  ['fa-truck-fast', 'Nationwide delivery'],
  ['fa-shield-halved', 'Secure checkout'],
  ['fa-message', 'Seller chat'],
  ['fa-rotate-left', 'Order support'],
];

export default function CategoryTrustBar() {
  return (
    <section className="category-trust-bar" aria-label="BUYSELL shopping benefits">
      {benefits.map(([icon, label]) => (
        <div key={label}>
          <i className={`fa-solid ${icon}`} />
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}
