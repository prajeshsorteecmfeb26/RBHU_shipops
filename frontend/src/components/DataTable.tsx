import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '../api/types';
import { EmptyState, ErrorState, Spinner } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hide on narrow screens; the row stays readable as a card on mobile */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  meta?: PageMeta;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  fetching?: boolean;
}

/** Generic, responsive table: a real <table> on desktop, stacked cards on mobile (CSS). */
export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, emptyTitle = 'Nothing here yet', emptyHint, meta, onPageChange, onRowClick, fetching }: Props<T>) {
  if (loading) return <div className="card"><Spinner /></div>;
  if (error) return <div className="card"><ErrorState message={error} onRetry={onRetry} /></div>;
  if (!rows?.length) return <div className="card"><EmptyState title={emptyTitle}>{emptyHint}</EmptyState></div>;

  return (
    <div className={`card table-card ${fetching ? 'is-fetching' : ''}`}>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.hideOnMobile ? 'hide-mobile' : ''} ${c.align === 'right' ? 'right' : ''}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? 'clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} data-label={c.header} className={`${c.hideOnMobile ? 'hide-mobile' : ''} ${c.align === 'right' ? 'right' : ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && onPageChange && meta.totalPages > 1 && (
        <nav className="pagination" aria-label="Pagination">
          <span className="muted">
            {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </span>
          <div className="pagination-buttons">
            <button className="icon-btn" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
            <span>Page {meta.page} / {meta.totalPages}</span>
            <button className="icon-btn" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
          </div>
        </nav>
      )}
    </div>
  );
}
