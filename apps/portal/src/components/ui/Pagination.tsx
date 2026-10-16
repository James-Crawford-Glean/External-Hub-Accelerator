import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** Choices for the rows-per-page control. Defaults to 10 / 25 / 50. */
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Noun used in the "Showing 1–10 of 42 activities" caption. */
  itemNoun?: string;
}

/**
 * Numbered pager with a rows-per-page control. Kept generic so any table or
 * list can adopt the same paging affordance. The page-number window collapses
 * with ellipses once there are more than seven pages, so the control never
 * wraps awkwardly regardless of dataset size.
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  pageSizeOptions = [10, 25, 50],
  onPageChange,
  onPageSizeChange,
  itemNoun = 'items',
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(page, pageCount);
  const start = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, totalItems);

  return (
    <div className="ps-pagination">
      <div className="ps-pagination__summary">
        <span className="ps-pagination__count">
          Showing <strong>{start}</strong>–<strong>{end}</strong> of{' '}
          <strong>{totalItems}</strong> {itemNoun}
        </span>
        <label className="ps-pagination__rows">
          <span>Rows</span>
          <select
            className="ps-pagination__select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ps-pagination__pages">
        <button
          type="button"
          className="ps-pagination__btn ps-pagination__btn--arrow"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </button>
        {pageWindow(current, pageCount).map((token, i) =>
          token === 'gap' ? (
            <span key={`gap-${i}`} className="ps-pagination__gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={token}
              type="button"
              className={`ps-pagination__btn${
                token === current ? ' ps-pagination__btn--active' : ''
              }`}
              onClick={() => onPageChange(token)}
              aria-current={token === current ? 'page' : undefined}
            >
              {token}
            </button>
          )
        )}
        <button
          type="button"
          className="ps-pagination__btn ps-pagination__btn--arrow"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

/**
 * Build the page-number sequence with ellipsis collapse. Always keeps the
 * first and last page plus a one-page neighborhood around the current page.
 */
function pageWindow(current: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const tokens: Array<number | 'gap'> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(pageCount - 1, current + 1);
  if (left > 2) tokens.push('gap');
  for (let p = left; p <= right; p++) tokens.push(p);
  if (right < pageCount - 1) tokens.push('gap');
  tokens.push(pageCount);
  return tokens;
}
