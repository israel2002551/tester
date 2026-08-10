export default function BrandHeader({ className = '', marketplaceHref = '/' }) {
  return (
    <header className={className}>
      <a className="category-brand" href="/">
        BUY<span>SELL</span>
      </a>
      <a className="btn btn-outline btn-sm" href={marketplaceHref}>
        <i className="fa-solid fa-house" /> Marketplace
      </a>
    </header>
  );
}
