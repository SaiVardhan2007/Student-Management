import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch, useListQuery } from '../hooks/index.js';
import { api, errorMessage } from '../api/client.js';
import DataTable from '../components/DataTable.jsx';
import DynamicForm from '../components/DynamicForm.jsx';
import FileLink from '../components/FileLink.jsx';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, PageLoader, SearchInput } from '../components/ui.jsx';
import { fmtDateTime, fullName, titleCase } from '../utils/format.js';
import { fileProblem } from '../utils/validation.js';

const CATEGORIES = ['academic', 'administrative', 'hostel', 'library', 'fees', 'infrastructure', 'other'].map((c) => ({ value: c, label: titleCase(c) }));
const STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'].map((c) => ({ value: c, label: titleCase(c) }));
const PRIORITIES = ['low', 'medium', 'high'].map((c) => ({ value: c, label: titleCase(c) }));

function Ticket({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const { data: t, loading, error, reload } = useFetch(`/complaints/${id}`);
  const assignees = useFetch('/users', { limit: 100, isActive: 'true' }, { enabled: user.role === 'admin' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); if (msg) toast.success(msg); await reload(); onChanged(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const send = () => reply.trim() && act(async () => { await api.post(`/complaints/${id}/respond`, { message: reply.trim() }); setReply(''); }, 'Reply sent');
  const canStaff = user.role === 'admin' || user.role === 'faculty';
  const closed = t && ['resolved', 'closed'].includes(t.status);

  return (
    <Modal title={t ? t.subject : 'Ticket'} onClose={onClose} size="lg">
      {loading ? <PageLoader /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <div className="stack">
          <div className="row"><Badge value={t.status} /><Badge value={t.priority} /><Badge tone="info">{t.category}</Badge><span className="muted small">{fullName(t.student)} · {fmtDateTime(t.createdAt)}</span></div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>
          {t.attachment && <FileLink file={t.attachment} />}
          {t.assignedTo && <p className="small muted">Assigned to <strong>{t.assignedTo.name}</strong></p>}
          <div>
            <h3 style={{ marginBottom: 6 }}>Conversation</h3>
            {!t.responses.length ? <p className="muted small">No replies yet.</p> : t.responses.map((r, i) => (
              <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}><div className="row-between small"><strong>{r.byName}</strong><span className="faint">{fmtDateTime(r.at)}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{r.message}</p></div>
            ))}
          </div>
          {!(closed && user.role === 'student') && user.role !== 'parent' && (
            <div className="stack">
              <textarea className="textarea" rows={3} placeholder="Write a reply…" aria-label="Reply" value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} />
              <div className="row"><Button variant="primary" onClick={send} loading={busy} disabled={!reply.trim()}>Send reply</Button>
                {user.role === 'student' && t.status !== 'closed' && <Button onClick={() => act(() => api.patch(`/complaints/${id}`, { status: 'closed' }), 'Ticket closed')}>Close ticket</Button>}</div>
            </div>
          )}
          {canStaff && (
            <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <label className="small strong" htmlFor="tk-status">Status</label>
              <select id="tk-status" className="select" style={{ width: 'auto' }} value={t.status} onChange={(e) => act(() => api.patch(`/complaints/${id}`, { status: e.target.value }), 'Status updated')}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              {user.role === 'admin' && (<><label className="small strong" htmlFor="tk-assign">Assign to</label>
                <select id="tk-assign" className="select" style={{ width: 'auto' }} value={t.assignedTo?._id || ''} onChange={(e) => e.target.value && act(() => api.patch(`/complaints/${id}`, { assignedTo: e.target.value }), 'Ticket assigned')}>
                  <option value="">Unassigned</option>{assignees.data?.filter((u) => ['admin', 'faculty'].includes(u.role)).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}</select></>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Complaints() {
  const { user } = useAuth();
  const list = useListQuery('/complaints', { limit: 15 });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const isStudent = user.role === 'student';

  const create = async (v) => {
    const fd = new FormData();
    ['category', 'subject', 'description', 'priority'].forEach((k) => v[k] && fd.append(k, v[k]));
    if (v.attachment) fd.append('attachment', v.attachment);
    await api.post('/complaints', fd);
    toast.success('Ticket submitted');
    setCreating(false);
    list.reload();
  };

  return (
    <div className="page">
      <PageHeader title="Support tickets" subtitle={isStudent ? 'Raise an issue and track its progress' : user.role === 'admin' ? 'Review, assign and resolve student tickets' : 'Tickets assigned to you'} actions={isStudent && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New ticket</Button>} />
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search tickets…" />
          <select className="select" aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}><option value="">Status: All</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          <select className="select" aria-label="Category" value={list.filters.category || ''} onChange={(e) => list.setFilter('category', e.target.value)}><option value="">Category: All</option>{CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </div>
        <DataTable
          columns={[
            { key: 'subject', label: 'Subject', render: (t) => <button style={{ all: 'unset', cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }} onClick={() => setOpenId(t._id)}>{t.subject}</button> },
            ...(!isStudent ? [{ key: 'student', label: 'Student', render: (t) => fullName(t.student) }] : []),
            { key: 'category', label: 'Category', render: (t) => titleCase(t.category) },
            { key: 'priority', label: 'Priority', sortKey: 'priority', render: (t) => <Badge value={t.priority} /> },
            { key: 'status', label: 'Status', sortKey: 'status', render: (t) => <Badge value={t.status} /> },
            { key: 'createdAt', label: 'Created', sortKey: 'createdAt', render: (t) => fmtDateTime(t.createdAt) },
          ]}
          rows={list.items} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} page={list.page} onPage={list.setPage} sort={list.sort} onSort={list.setSort}
          empty={<EmptyState icon="inbox" title="No tickets" message={isStudent ? 'Raise a ticket if you need help from the college.' : undefined} />}
        />
      </Card>
      {creating && (
        <Modal title="New support ticket" onClose={() => setCreating(false)}>
          <DynamicForm initial={{ category: 'academic', priority: 'medium' }} submitLabel="Submit ticket" busyLabel="Submitting…" onCancel={() => setCreating(false)} onSubmit={create}
            fields={[
              { name: 'subject', label: 'Subject', required: true, maxLength: 200, span2: true, validate: (v) => (v.length < 3 ? 'Subject is too short' : null) },
              { name: 'category', label: 'Category', type: 'select', options: CATEGORIES, required: true }, { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, required: true },
              { name: 'description', label: 'Describe the issue', type: 'textarea', rows: 5, required: true, maxLength: 5000, validate: (v) => (v.length < 10 ? 'Please add a little more detail (min 10 characters)' : null) },
              { name: 'attachment', label: 'Attachment (optional)', type: 'file', validate: (f) => fileProblem(f), span2: true },
            ]} />
        </Modal>
      )}
      {openId && <Ticket id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}
