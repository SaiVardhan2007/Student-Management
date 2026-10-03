import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { useListQuery } from '../hooks/index.js';
import { api, errorMessage } from '../api/client.js';
import DataTable, { RowAction } from '../components/DataTable.jsx';
import DynamicForm from '../components/DynamicForm.jsx';
import FileLink from '../components/FileLink.jsx';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SearchInput } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { fmtDate, fullName, titleCase } from '../utils/format.js';
import { fileProblem } from '../utils/validation.js';

const TYPES = [['certificate', 'Certificate'], ['marksheet', 'Mark sheet'], ['id_proof', 'ID document'], ['internship', 'Internship certificate'], ['other', 'Other']].map(([value, label]) => ({ value, label }));
const STATUSES = ['pending', 'verified', 'rejected', 'reupload_requested'].map((s) => ({ value: s, label: titleCase(s) }));

export default function Documents() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const isStudent = user.role === 'student';
  const list = useListQuery('/documents', { limit: 15 });
  const [upload, setUpload] = useState(false);
  const [review, setReview] = useState(null);
  const confirm = useConfirm();

  const doUpload = async (v) => {
    const fd = new FormData();
    fd.append('title', v.title); fd.append('type', v.type); fd.append('file', v.file);
    await api.post('/documents', fd);
    toast.success('Document uploaded and awaiting verification');
    setUpload(false);
    list.reload();
  };
  const remove = async (d) => {
    if (!(await confirm({ title: 'Delete document?', message: `"${d.title}" will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/documents/${d._id}`); toast.success('Document deleted'); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="page">
      <PageHeader title="Documents" subtitle={isAdmin ? 'Verify documents submitted by students' : 'Upload certificates and identity documents for verification'} actions={isStudent && <Button variant="primary" icon="upload" onClick={() => setUpload(true)}>Upload document</Button>} />
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title…" />
          <select className="select" aria-label="Status" value={list.filters.status || ''} onChange={(e) => list.setFilter('status', e.target.value)}><option value="">Status: All</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          <select className="select" aria-label="Type" value={list.filters.type || ''} onChange={(e) => list.setFilter('type', e.target.value)}><option value="">Type: All</option>{TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </div>
        <DataTable
          columns={[
            ...(isAdmin || user.role === 'parent' ? [{ key: 'student', label: 'Student', render: (d) => `${d.student?.studentId} · ${fullName(d.student)}` }] : []),
            { key: 'title', label: 'Document', sortKey: 'title', render: (d) => <strong>{d.title}</strong> },
            { key: 'type', label: 'Type', render: (d) => titleCase(d.type) },
            { key: 'file', label: 'File', render: (d) => <FileLink file={d.file} label="View" /> },
            { key: 'status', label: 'Status', sortKey: 'status', render: (d) => <div><Badge value={d.status} />{d.reviewNote && <div className="small muted" style={{ maxWidth: 240 }}>{d.reviewNote}</div>}</div> },
            { key: 'createdAt', label: 'Uploaded', sortKey: 'createdAt', render: (d) => fmtDate(d.createdAt) },
          ]}
          rows={list.items} loading={list.loading} error={list.error} onRetry={list.reload} meta={list.meta} page={list.page} onPage={list.setPage} sort={list.sort} onSort={list.setSort}
          empty={<EmptyState icon="file" title="No documents" message={isStudent ? 'Upload your certificates and IDs to get them verified.' : undefined} />}
          actions={(d) => (
            <>
              {isAdmin && <Button size="sm" onClick={() => setReview(d)}>Review</Button>}
              {(isAdmin || (isStudent && d.status !== 'verified')) && <RowAction icon="trash" danger label="Delete document" onClick={() => remove(d)} />}
            </>
          )}
        />
      </Card>
      {upload && (
        <Modal title="Upload document" onClose={() => setUpload(false)} size="sm">
          <DynamicForm initial={{ type: 'certificate' }} submitLabel="Upload" busyLabel="Uploading…" onCancel={() => setUpload(false)} onSubmit={doUpload}
            fields={[{ name: 'title', label: 'Title', required: true, maxLength: 150, span2: true }, { name: 'type', label: 'Type', type: 'select', options: TYPES, required: true, span2: true }, { name: 'file', label: 'File', type: 'file', required: true, span2: true, hint: 'PDF or image recommended — max 10 MB', validate: (f) => fileProblem(f) }]} />
        </Modal>
      )}
      {review && (
        <Modal title={`Review: ${review.title}`} onClose={() => setReview(null)} size="sm">
          <p className="muted small" style={{ marginBottom: 10 }}>{fullName(review.student)} · <FileLink file={review.file} label="Open file" /></p>
          <DynamicForm initial={{ status: 'verified' }} submitLabel="Save decision" onCancel={() => setReview(null)}
            onSubmit={async (v) => { await api.patch(`/documents/${review._id}/review`, { status: v.status, ...(v.reviewNote ? { reviewNote: v.reviewNote } : {}) }); toast.success('Decision saved'); setReview(null); list.reload(); }}
            fields={[{ name: 'status', label: 'Decision', type: 'select', required: true, span2: true, options: [{ value: 'verified', label: 'Verify' }, { value: 'rejected', label: 'Reject' }, { value: 'reupload_requested', label: 'Request re-upload' }] }, { name: 'reviewNote', label: 'Note to student', type: 'textarea', span2: true, maxLength: 500, hint: 'Required when rejecting or requesting a re-upload', validate: (v, all) => (all.status !== 'verified' && !v ? 'Please add a note explaining the decision' : null) }]} />
        </Modal>
      )}
    </div>
  );
}
