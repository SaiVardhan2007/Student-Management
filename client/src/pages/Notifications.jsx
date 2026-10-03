import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useListQuery } from '../hooks/index.js';
import { api, errorMessage } from '../api/client.js';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, TableSkeleton } from '../components/ui.jsx';
import { Pagination } from '../components/DataTable.jsx';
import { fmtDateTime } from '../utils/format.js';

export default function Notifications() {
  const navigate = useNavigate();
  const list = useListQuery('/notifications', { limit: 15 });
  const unreadOnly = list.filters.unread === 'true';

  const markAll = async () => {
    try { await api.post('/notifications/read-all'); toast.success('All notifications marked as read'); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const open = async (n) => {
    if (!n.isRead) { try { await api.patch(`/notifications/${n._id}/read`); list.reload(); } catch { /* non-critical */ } }
    if (n.link) navigate(n.link);
  };
  const remove = async (n) => {
    try { await api.delete(`/notifications/${n._id}`); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="page">
      <PageHeader title="Notifications" subtitle={list.meta?.unread ? `${list.meta.unread} unread` : 'You are all caught up'}
        actions={<><Button onClick={() => list.setFilter('unread', unreadOnly ? '' : 'true')}>{unreadOnly ? 'Show all' : 'Unread only'}</Button><Button variant="primary" onClick={markAll} disabled={!list.meta?.unread}>Mark all as read</Button></>} />
      <Card bodyClass={null}>
        {list.loading && !list.items.length ? <TableSkeleton cols={2} /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.items.length ? <EmptyState icon="bell" title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} /> : (
          <ul className="list" style={{ padding: '0 16px' }}>
            {list.items.map((n) => (
              <li key={n._id} className="row-between" style={{ opacity: n.isRead ? 0.75 : 1 }}>
                <button onClick={() => open(n)} style={{ all: 'unset', cursor: 'pointer', flex: 1 }} aria-label={`Open notification: ${n.title}`}>
                  <div className="row" style={{ gap: 8 }}>{!n.isRead && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--primary)' }} />}<strong>{n.title}</strong><Badge>{n.type}</Badge></div>
                  {n.message && <div className="muted small">{n.message}</div>}
                  <div className="faint small">{fmtDateTime(n.createdAt)}</div>
                </button>
                <Button size="sm" variant="ghost" onClick={() => remove(n)} aria-label="Dismiss notification" icon="x" />
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={list.meta} page={list.page} onPage={list.setPage} />
      </Card>
    </div>
  );
}
