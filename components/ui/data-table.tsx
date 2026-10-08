'use client';

// Reusable table with sorting, pagination and mobile layout. Used by ResourcePage and several dashboard pages.

import Icon from '@/components/ui/icon';
import { Button, EmptyState, ErrorState, TableSkeleton } from '@/components/ui';

/** "Showing 1-15 of 40" text plus previous/next buttons. meta comes from the API list response. */
export function Pagination({ meta, page, onPage }: any) {
  // keep the pager when we are past the last page (for example after deleting its only row)
  if (!meta || (meta.total === 0 && page <= 1)) return null;
  const from = meta.total ? (meta.page - 1) * meta.limit + 1 : 0;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="small">
        Showing {from}–{to} of {meta.total}
      </span>
      <div className="pages">
        <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <span className="small" aria-live="polite">
          Page {meta.page} of {meta.pages}
        </span>
        <Button size="sm" icon="chevronRight" disabled={page >= meta.pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </nav>
  );
}

/**
 * columns: [{ key, label, render?(row), sortKey?, className? }]
 *   render  custom cell content (default: row[key], or a dash when empty)
 *   sortKey makes the header clickable; sort is '-field' when descending
 * actions(row) returns the buttons for the last column.
 * On small screens the rows stack into label/value cards (CSS uses data-label).
 */
export default function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  meta,
  page,
  onPage,
  sort,
  onSort,
  empty,
  rowKey = '_id',
  actions,
}: any) {
  if (error && !rows?.length) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && !rows?.length) return <TableSkeleton cols={Math.min(columns.length, 6)} />;
  if (!loading && !rows?.length) {
    return page > 1 ? (
      <>
        {empty}
        <Pagination meta={meta} page={page} onPage={onPage} />
      </>
    ) : (
      empty || <EmptyState title="No records found" message="Try adjusting your search or filters." />
    );
  }

  // Clicking the same column again flips between ascending and descending
  const toggleSort = (key) => onSort?.(sort === key ? `-${key}` : key);

  const sortArrow = (key) => {
    if (sort === key) return ' ▲';
    if (sort === `-${key}`) return ' ▼';
    return '';
  };

  const ariaSort = (key) => {
    if (sort === key) return 'ascending';
    if (sort === `-${key}`) return 'descending';
    return 'none';
  };

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.sortKey ? 'sortable' : ''}
                  aria-sort={c.sortKey ? ariaSort(c.sortKey) : undefined}
                >
                  {c.sortKey ? (
                    <button onClick={() => toggleSort(c.sortKey)}>
                      {c.label}
                      {sortArrow(c.sortKey)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              {actions && (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[rowKey]}>
                {columns.map((c) => (
                  <td key={c.key} data-label={c.label} className={c.className}>
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
                {actions && <td className="actions">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination meta={meta} page={page} onPage={onPage} />
    </div>
  );
}

/** Small icon button used in the actions column (edit, delete, ...). */
export function RowAction({ icon, label, onClick, danger }: any) {
  return (
    <button
      className="btn btn-ghost btn-icon btn-sm"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={danger ? { color: 'var(--danger)' } : undefined}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
