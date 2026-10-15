import React from 'react';

export default function Pagination({
  totalPages,
  currentPage,
  totalItems,
  startIndex,
  endIndex,
  onPageChange,
  itemLabel = 'products',
}) {
  if (totalPages <= 1) return null;

  // Build list of page numbers and ellipsis
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('ellipsis-start');

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) pages.push('ellipsis-end');
    pages.push(totalPages);
  }

  return (
    <nav className="bs-pagination-container" aria-label="Catalog pagination">
      <div className="bs-pagination-info">
        Showing <strong>{startIndex + 1}–{endIndex}</strong> of <strong>{totalItems}</strong> {itemLabel} (Page {currentPage} of {totalPages})
      </div>
      <div className="bs-pagination-controls">
        <button
          type="button"
          className="bs-page-btn bs-page-prev"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
          <span>Prev</span>
        </button>

        {pages.map((p, idx) => {
          if (typeof p === 'string') {
            return (
              <span key={`el-${idx}`} className="bs-page-ellipsis" aria-hidden="true">
                …
              </span>
            );
          }
          const isActive = p === currentPage;
          return (
            <button
              key={p}
              type="button"
              className={`bs-page-btn ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={`Page ${p}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          className="bs-page-btn bs-page-next"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <span>Next</span>
          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
