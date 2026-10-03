import { useState } from 'react';
import { useFetch, useListQuery } from '../hooks/index.js';
import DataTable from '../components/DataTable.jsx';
import { Badge, Card, EmptyState, Modal, PageHeader, SearchInput } from '../components/ui.jsx';
import { fmtDateTime, titleCase } from '../utils/format.js';

export default function AuditLogs() {
  const list = useListQuery('/audit-logs', { limit: 20, initialSort: '-timestamp' });
  const actions = useFetch('/audit-logs/actions');
  const [detail, setDetail] = useState(null);
  return (
    <div className="page">
      <PageHeader title="Audit logs" subtitle="A record of who did what and when. Secrets and passwords are never stored." />
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search user, action, entity…" />
          <select className="select" aria-label="Action" value={list.filters.action || ''} onChange={(e) => list.setFilter('action', e.target.value)}><option value="">Action: All</option>{actions.data?.map((a) => <option key={a} value={a}>{titleCase(a.toLowerCase())}</option>)}</select>
          <select className="select" aria-label="Role" value={list.filters.role || ''} onChange={(e) => list.setFilter('role', e.target.value)}><option value="">Role: All</option>{['admin', 'faculty', 'student', 'parent'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</select>
          <input className="input" style={{ width: 'auto' }} type="date" aria-label="From date" value={list.filters.from || ''} onChange={(e) => list.setFilter('from', e.target.value)} />
          <input className="input" style={{ width: 'auto' }} type="date" aria-label="To date" value={list.filters.to || ''} onChange={(e) => list.setFilter('to', e.target.value)} />
        </div>
        <DataTable
          columns={[
            { key: 'timestamp', label: 'When', sortKey: 'timestamp', render: (l) => <span className="nowrap">{fmtDateTime(l.timestamp)}</span> },
            { key: 'user', label: 'User', render: (l) => <div><strong>{l.userName || 'System'}</strong> {l.role && <Badge>{l.role}</Badge>}</div> },
            { key: 'action', label: 'Action', sortKey: 'action', render: (l) => <Badge tone={/FAILED|DELETED|DEACTIVATED|REJECTED/.test(l.action) ? 'danger' : /CHANGED|UPDATED/.test(l.action) ? 'warning' : 'primary'}>{titleCase(l.action.toLowerCase())}</Badge> },
            { key: 'entity', label: 'Entity', render: (l) => (l.entity ? `${l.entity}${l.entityId ? ` · …${l.entityId.slice(-6)}` : ''}` : '—') },
            { key: 'ip', label: 'IP', render: (l) => <span className="faint small">{l.ip || '—'}</span> },
          ]}
          rows={list.items} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} page={list.page} onPage={list.setPage} sort={list.sort} onSort={list.setSort}
          empty={<EmptyState icon="shield" title="No log entries match" />}
          actions={(l) => l.details ? <button className="btn btn-ghost btn-sm" onClick={() => setDetail(l)}>Details</button> : null}
        />
      </Card>
      {detail && <Modal title={titleCase(detail.action.toLowerCase())} onClose={() => setDetail(null)}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{JSON.stringify(detail.details, null, 2)}</pre></Modal>}
    </div>
  );
}
