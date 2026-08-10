export default function LoadingGrid({ count = 4, className = 'products-grid', height = 250 }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton" style={{ height }} key={index} />
      ))}
    </div>
  );
}
