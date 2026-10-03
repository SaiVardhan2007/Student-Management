import Icon from './Icon.jsx';
import { Button, EmptyState, ErrorState, TableSkeleton } from './ui.jsx';

export function Pagination({ meta, page, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="small">Showing {from}–{to} of {meta.total}</span>
      <div className="pages">
        <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <span className="small" aria-live="polite">Page {meta.page} of {meta.pages}</span>
        <Button size="sm" icon="chevronRight" disabled={page >= meta.pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </nav>
  );
}

/**
 * columns: [{ key, label, render?(row), sortKey?, className? }]
 * Stacks into label/value cards on small screens.
 */
export default function DataTable({ columns, rows, loading, error, onRetry, meta, page, onPage, sort, onSort, empty, rowKey = '_id', actions }) {
  if (error && !rows?.length) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && !rows?.length) return <TableSkeleton cols={Math.min(columns.length, 6)} />;
  if (!loading && !rows?.length) return empty || <EmptyState title="No records found" message="Try adjusting your search or filters." />;

  const toggleSort = (k) => onSort?.(sort === k ? `-${k}` : k);
  const arrow = (k) => (sort === k ? ' ▲' : sort === `-${k}` ? ' ▼' : '');

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.sortKey ? 'sortable' : ''} aria-sort={c.sortKey ? (sort === c.sortKey ? 'ascending' : sort === `-${c.sortKey}` ? 'descending' : 'none') : undefined}>
                  {c.sortKey ? <button onClick={() => toggleSort(c.sortKey)}>{c.label}{arrow(c.sortKey)}</button> : c.label}
                </th>
              ))}
              {actions && <th><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[rowKey]}>
                {columns.map((c) => <td key={c.key} data-label={c.label} className={c.className}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>)}
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

export function RowAction({ icon, label, onClick, danger }) {
  return (
    <button className="btn btn-ghost btn-icon btn-sm" onClick={onClick} aria-label={label} title={label} style={danger ? { color: 'var(--danger)' } : undefined}>
      <Icon name={icon} size={16} />
    </button>
  );
}
