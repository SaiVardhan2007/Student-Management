'use client';

// Achievements. Students add achievements (with an optional certificate) and can delete their
// unverified ones. Faculty/admin verify or reject pending ones; only admin can delete any.
// API: /achievements

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { useListQuery } from '@/hooks';
import { api, errorMessage } from '@/lib/api-client';
import DataTable, { RowAction } from '@/components/ui/data-table';
import DynamicForm from '@/components/ui/dynamic-form';
import FileLink from '@/components/ui/file-link';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SearchInput } from '@/components/ui';
import { useConfirm } from '@/components/providers/confirm-provider';
import { fmtDate, fullName, titleCase } from '@/lib/format';
import { fileProblem } from '@/lib/validation';

const CATS = ['certification', 'hackathon', 'sports', 'technical', 'cultural', 'other'].map((c) => ({ value: c, label: titleCase(c) }));

export default function Achievements() {
  const { user } = useAuth();
  const isStudent = user.role === 'student';
  const staff = user.role === 'admin' || user.role === 'faculty';
  const list = useListQuery('/achievements', { limit: 15 });
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  const canDelete = (a) => user.role === 'admin' || (isStudent && a.status !== 'verified');

  const add = async (v) => {
    // FormData is needed because the certificate is a file upload.
    const fd = new FormData();
    for (const key of ['title', 'category', 'description', 'date']) {
      if (v[key]) fd.append(key, v[key]);
    }
    if (v.certificate) fd.append('certificate', v.certificate);
    await api.post('/achievements', fd);
    toast.success('Achievement added and sent for verification');
    setAdding(false);
    list.reload();
  };
  const verify = async (a, status) => {
    try {
      await api.patch(`/achievements/${a._id}/verify`, { status });
      toast.success(`Achievement ${status}`);
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async (a) => {
    const ok = await confirm({ title: 'Delete achievement?', message: `"${a.title}" will be removed.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/achievements/${a._id}`);
      toast.success('Deleted');
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Achievements"
        subtitle={isStudent ? 'Record certifications, competitions and activities' : 'Verify student achievements'}
        actions={
          isStudent && (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add achievement
            </Button>
          )
        }
      />
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title…" />
          <select
            className="select"
            aria-label="Category"
            value={list.filters.category || ''}
            onChange={(e) => list.setFilter('category', e.target.value)}
          >
            <option value="">Category: All</option>
            {CATS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Status"
            value={list.filters.status || ''}
            onChange={(e) => list.setFilter('status', e.target.value)}
          >
            <option value="">Status: All</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <DataTable
          columns={[
            ...(!isStudent
              ? [{ key: 'student', label: 'Student', render: (a) => `${a.student?.studentId} · ${fullName(a.student)}` }]
              : []),
            {
              key: 'title',
              label: 'Achievement',
              sortKey: 'title',
              render: (a) => (
                <div>
                  <strong>{a.title}</strong>
                  {a.description && <div className="small muted">{a.description}</div>}
                </div>
              ),
            },
            { key: 'category', label: 'Category', render: (a) => titleCase(a.category) },
            { key: 'date', label: 'Date', sortKey: 'date', render: (a) => fmtDate(a.date) },
            { key: 'certificate', label: 'Certificate', render: (a) => <FileLink file={a.certificate} label="View" /> },
            { key: 'status', label: 'Status', sortKey: 'status', render: (a) => <Badge value={a.status} /> },
          ]}
          rows={list.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          meta={list.meta}
          page={list.page}
          onPage={list.setPage}
          sort={list.sort}
          onSort={list.setSort}
          empty={<EmptyState icon="award" title="No achievements yet" />}
          actions={(a) => (
            <>
              {staff && a.status === 'pending' && (
                <>
                  <Button size="sm" variant="primary" onClick={() => verify(a, 'verified')}>
                    Verify
                  </Button>{' '}
                  <Button size="sm" onClick={() => verify(a, 'rejected')}>
                    Reject
                  </Button>
                </>
              )}
              {canDelete(a) && <RowAction icon="trash" danger label="Delete achievement" onClick={() => remove(a)} />}
            </>
          )}
        />
      </Card>
      {adding && (
        <Modal title="Add achievement" onClose={() => setAdding(false)}>
          <DynamicForm
            initial={{ category: 'certification' }}
            submitLabel="Add"
            busyLabel="Saving…"
            onCancel={() => setAdding(false)}
            onSubmit={add}
            fields={[
              {
                name: 'title',
                label: 'Title',
                required: true,
                maxLength: 200,
                span2: true,
                validate: (v) => (v.length < 3 ? 'Title is too short' : null),
              },
              { name: 'category', label: 'Category', type: 'select', options: CATS, required: true },
              { name: 'date', label: 'Date', type: 'date' },
              { name: 'description', label: 'Description', type: 'textarea', maxLength: 2000 },
              { name: 'certificate', label: 'Certificate (optional)', type: 'file', span2: true, validate: (f) => fileProblem(f) },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
