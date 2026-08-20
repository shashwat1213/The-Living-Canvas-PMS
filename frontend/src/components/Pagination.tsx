import type { PageMeta } from '../lib/pagination';
import './ui.css';

interface PaginationProps {
  page: PageMeta;
  onPageChange: (page: number) => void;
  /** Plural noun for the total, e.g. "people" / "properties". */
  itemLabel?: string;
  /** Disables the controls while a page is being fetched. */
  busy?: boolean;
}

/**
 * Pagination controls for a paginated list. Domain-free: it takes the
 * server's own page metadata and reports which page was asked for,
 * nothing else.
 *
 * Deliberately Previous/Next plus a position readout rather than numbered
 * page buttons — numbered pages need a windowing algorithm to stay usable
 * past a handful of pages, and nothing in the product needs to jump to
 * page 47 yet. The readout is a live region so the position is announced
 * after a page change instead of only being visible.
 */
export function Pagination({ page, onPageChange, itemLabel = 'items', busy = false }: PaginationProps) {
  // One page of results needs no controls, but the total is still worth
  // showing — it answers "how many are there" without arithmetic.
  const showControls = page.totalPages > 1;

  const first = page.totalItems === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.page * page.pageSize, page.totalItems);

  return (
    <div className="pagination">
      <p className="pagination-status" role="status">
        {page.totalItems === 0
          ? `No ${itemLabel}`
          : showControls
            ? `${first}–${last} of ${page.totalItems} ${itemLabel}`
            : `${page.totalItems} ${page.totalItems === 1 ? itemLabel.replace(/s$/, '') : itemLabel}`}
      </p>

      {showControls && (
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onPageChange(page.page - 1)}
            disabled={busy || page.page <= 1}
          >
            Previous
          </button>
          <span className="pagination-position">
            Page {page.page} of {page.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onPageChange(page.page + 1)}
            disabled={busy || page.page >= page.totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
