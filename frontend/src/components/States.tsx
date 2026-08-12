import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export function PageLoader({ label = 'Loading your experience' }: { label?: string }) {
  return (
    <div className="state-panel state-panel--loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <strong>{label}</strong>
      <span>This should only take a moment.</span>
    </div>
  );
}

export function CardSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid" aria-label="Products are loading" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="product-skeleton" key={index}>
          <span className="skeleton skeleton--image" />
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--line skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <span className="state-panel__icon"><AlertTriangle aria-hidden="true" /></span>
      <h2>{title}</h2>
      <p>{message ?? 'We could not load this information. Check your connection and try again.'}</p>
      {onRetry && <button className="button button--secondary" onClick={onRetry}><RefreshCw aria-hidden="true" /> Try again</button>}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="state-panel">
      <span className="state-panel__icon"><Inbox aria-hidden="true" /></span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}
