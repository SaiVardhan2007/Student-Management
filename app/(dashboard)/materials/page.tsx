'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { useListQuery } from '@/hooks';
import { api } from '@/lib/api-client';
import DataTable, { RowAction } from '@/components/ui/data-table';
import DynamicForm, { clearOptionCache } from '@/components/ui/dynamic-form';
import FileLink from '@/components/ui/file-link';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SearchInput } from '@/components/ui';
import { useConfirm } from '@/components/providers/confirm-provider';
import { errorMessage } from '@/lib/api-client';
import { fmtDate, titleCase } from '@/lib/format';
import { fileProblem } from '@/lib/validation';

const TYPES = ['notes', 'pdf', 'assignment', 'question_paper', 'reference'].map((t) => ({ value: t, label: titleCase(t) }));

export default function Materials() {
  const { user } = useAuth();
  const canUpload = user.role !== 'student';
  const list = useListQuery('/materials', { limit: 15 });
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();

  const upload = async (v) => {
    const fd = new FormData();
    fd.append('title', v.title);
    fd.append('subject', v.subject);
    fd.append('type', v.type);
    if (v.description) fd.append('description', v.description);
    fd.append('file', v.file);
    await api.post('/materials', fd);
    toast.success('Material uploaded');
    clearOptionCache();
    setOpen(false);
    list.reload();
  };
  const remove = async (m) => {
    if (
      !(await confirm({
        title: 'Delete material?',
        message: `"${m.title}" will be permanently removed for all students.`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.delete(`/materials/${m._id}`);
      toast.success('Material deleted');
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Study materials"
        subtitle={canUpload ? 'Upload notes, papers and references for your subjects' : 'Materials shared for your enrolled subjects'}
        actions={
          canUpload && (
            <Button variant="primary" icon="upload" onClick={() => setOpen(true)}>
              Upload material
            </Button>
          )
        }
      />
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title…" />
          <select
            className="select"
            aria-label="Type"
            value={list.filters.type || ''}
            onChange={(e) => list.setFilter('type', e.target.value)}
          >
            <option value="">Type: All</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          columns={[
            {
              key: 'title',
              label: 'Title',
              sortKey: 'title',
              render: (m) => (
                <div>
                  <strong>{m.title}</strong>
                  {m.description && <div className="muted small">{m.description}</div>}
                </div>
              ),
            },
            { key: 'subject', label: 'Subject', render: (m) => m.subject?.code },
            { key: 'type', label: 'Type', render: (m) => <Badge tone="info">{titleCase(m.type)}</Badge> },
            { key: 'file', label: 'File', render: (m) => <FileLink file={m.file} label="Download" /> },
            { key: 'uploadedBy', label: 'By', render: (m) => m.uploadedBy?.name },
            { key: 'createdAt', label: 'Uploaded', sortKey: 'createdAt', render: (m) => fmtDate(m.createdAt) },
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
          empty={
            <EmptyState
              icon="layers"
              title="No materials yet"
              message={canUpload ? 'Upload the first study material for your subject.' : 'Your faculty have not shared any materials yet.'}
            />
          }
          actions={canUpload ? (m) => <RowAction icon="trash" danger label="Delete material" onClick={() => remove(m)} /> : undefined}
        />
      </Card>
      {open && (
        <Modal title="Upload study material" onClose={() => setOpen(false)}>
          <DynamicForm
            initial={{ type: 'notes' }}
            submitLabel="Upload"
            busyLabel="Uploading…"
            onCancel={() => setOpen(false)}
            onSubmit={upload}
            fields={[
              { name: 'title', label: 'Title', required: true, maxLength: 200, span2: true },
              {
                name: 'subject',
                label: 'Subject',
                type: 'select',
                required: true,
                optionsUrl: '/subjects',
                optionsParams: { mine: 'true' },
                optionLabel: (s) => `${s.code} — ${s.name}`,
              },
              { name: 'type', label: 'Type', type: 'select', options: TYPES, required: true },
              { name: 'description', label: 'Description', type: 'textarea', maxLength: 1000 },
              {
                name: 'file',
                label: 'File',
                type: 'file',
                required: true,
                hint: 'PDF, Office, image, text or zip — max 10 MB',
                validate: (f) => fileProblem(f),
              },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
