import type { ReactNode } from 'react';

import './ui.css';

export interface Column<T> {
  /** Stable key, also used as the React key for cells. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Hidden below the narrow breakpoint — for secondary columns. */
  secondary?: boolean;
  /** Right-aligns the column; intended for the trailing actions cell. */
  align?: 'start' | 'end';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | null;
  rowKey: (row: T) => string;
  /** Accessible name for the table. */
  caption: string;
  /** Shown when `rows` is an empty array (not while loading). */
  emptyState: ReactNode;
  loadingLabel?: string;
  /** Marks a row as the current user's own, or otherwise notable. */
  highlightRow?: (row: T) => boolean;
}

/**
 * A typed, presentational table. It owns exactly three things — the
 * loading placeholder, the empty state, and the markup — and knows
 * nothing about any particular domain: no fetching, no sorting policy, no
 * feature-specific columns. Filtering and data loading stay with the
 * feature that owns the data, which is what keeps this reusable by the
 * next module rather than by staff alone.
 *
 * `rows === null` means "still loading"; `[]` means "loaded, nothing to
 * show". Keeping those distinct is what stops an empty state from
 * flashing before the first response arrives.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyState,
  loadingLabel = 'Loading…',
  highlightRow,
}: DataTableProps<T>) {
  if (rows === null) {
    return (
      <p className="page-loading" role="status">
        {loadingLabel}
      </p>
    );
  }

  if (rows.length === 0) {
    return <div className="empty-state">{emptyState}</div>;
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`${column.secondary ? 'col-secondary' : ''} ${column.align === 'end' ? 'col-end' : ''}`.trim()}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={highlightRow?.(row) ? 'row-highlight' : undefined}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${column.secondary ? 'col-secondary' : ''} ${column.align === 'end' ? 'col-end' : ''}`.trim()}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
