import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { useListQuery } from '../hooks/index.js';
import { api, errorMessage } from '../api/client.js';
import DataTable, { RowAction } from '../components/DataTable.jsx';
import DynamicForm from '../components/DynamicForm.jsx';
import ResourcePage from '../components/ResourcePage.jsx';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Tabs } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { fmtDate, fmtMoney, fullName } from '../utils/format.js';

function Books({ admin }) {
  const [issuing, setIssuing] = useState(null);
  const book = {
    title: 'Books', endpoint: '/library/books', entity: 'book', createLabel: 'Add book', defaultSort: 'title', searchPlaceholder: 'Search title, author, ISBN…',
    fields: admin ? [
      { name: 'title', label: 'Title', required: true, span2: true }, { name: 'authors', label: 'Authors (comma separated)', required: true, span2: true },
      { name: 'isbn', label: 'ISBN', required: true, pattern: /^[0-9Xx-]{10,17}$/, patternMessage: 'ISBN must be 10–13 digits' }, { name: 'category', label: 'Category' },
      { name: 'totalCopies', label: 'Total copies', type: 'number', min: 1, required: true },
    ] : [],
    toForm: (b) => ({ title: b.title, authors: b.authors.join(', '), isbn: b.isbn, category: b.category, totalCopies: String(b.totalCopies) }),
    toPayload: (v) => ({ ...v, authors: String(v.authors).split(',').map((a) => a.trim()).filter(Boolean), totalCopies: Number(v.totalCopies) }),
    canCreate: admin, canEdit: () => admin, canDelete: () => admin,
    columns: [
      { key: 'title', label: 'Title', sortKey: 'title', render: (b) => <strong>{b.title}</strong> }, { key: 'authors', label: 'Authors', render: (b) => b.authors.join(', ') },
      { key: 'isbn', label: 'ISBN' }, { key: 'category', label: 'Category', sortKey: 'category', render: (b) => b.category || '—' },
      { key: 'availableCopies', label: 'Available', sortKey: 'availableCopies', render: (b) => <Badge tone={b.availableCopies ? 'success' : 'danger'}>{b.availableCopies}/{b.totalCopies}</Badge> },
    ],
    rowActions: admin ? (b) => <RowAction icon="book" label="Issue this book" onClick={() => setIssuing(b)} /> : undefined,
  };
  return (
    <>
      <ResourcePage {...book} subtitle="Catalogue and availability" />
      {issuing && (
        <Modal title={`Issue "${issuing.title}"`} onClose={() => setIssuing(null)} size="sm">
          <DynamicForm submitLabel="Issue book" onCancel={() => setIssuing(null)}
            onSubmit={async (v) => { await api.post('/library/issue', { book: issuing._id, student: v.student }); toast.success('Book issued'); setIssuing(null); }}
            fields={[{ name: 'student', label: 'Student', type: 'select', required: true, span2: true, optionsUrl: '/students', optionsParams: { status: 'active' }, optionLabel: (s) => `${s.studentId} — ${s.firstName} ${s.lastName}` }]} />
        </Modal>
      )}
    </>
  );
}

function Issues({ admin }) {
  const list = useListQuery('/library/issues', { limit: 15, initialFilters: { status: 'active' } });
  const confirm = useConfirm();
  const ret = async (i) => {
    if (!(await confirm({ title: 'Return book?', message: `Mark "${i.book?.title}" as returned${i.overdue ? ` (fine ${fmtMoney(i.currentFine)} applies)` : ''}.`, confirmLabel: 'Return' }))) return;
    try { const r = await api.post(`/library/return/${i._id}`); toast.success(r.data.message); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card bodyClass={null}>
      <div className="table-toolbar"><select className="select" aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}><option value="">All</option><option value="active">Currently issued</option><option value="returned">Returned</option></select></div>
      <DataTable
        columns={[
          { key: 'book', label: 'Book', render: (i) => <strong>{i.book?.title}</strong> },
          { key: 'student', label: 'Student', render: (i) => `${i.student?.studentId} · ${fullName(i.student)}` },
          { key: 'issuedAt', label: 'Issued', sortKey: 'issuedAt', render: (i) => fmtDate(i.issuedAt) }, { key: 'dueDate', label: 'Due', sortKey: 'dueDate', render: (i) => fmtDate(i.dueDate) },
          { key: 'returnedAt', label: 'Returned', render: (i) => (i.returnedAt ? fmtDate(i.returnedAt) : <Badge tone={i.overdue ? 'danger' : 'info'}>{i.overdue ? 'Overdue' : 'Issued'}</Badge>) },
          { key: 'fine', label: 'Fine', render: (i) => (i.currentFine ? fmtMoney(i.currentFine) : '—') },
        ]}
        rows={list.items} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} page={list.page} onPage={list.setPage} sort={list.sort} onSort={list.setSort}
        empty={<EmptyState icon="book" title="No borrowing records" />}
        actions={admin ? (i) => !i.returnedAt && <Button size="sm" onClick={() => ret(i)}>Return</Button> : undefined}
      />
    </Card>
  );
}

export default function Library() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const [tab, setTab] = useState(admin ? 'books' : 'issues');
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[...(admin || user.role === 'student' ? [{ value: 'books', label: 'Catalogue' }] : []), { value: 'issues', label: admin ? 'Issued books' : 'My borrowing history' }]} />
      {tab === 'books' ? <Books admin={admin} /> : <div className="page"><PageHeader title="Borrowing" subtitle="Issued books, due dates and fines" /><Issues admin={admin} /></div>}
    </div>
  );
}
