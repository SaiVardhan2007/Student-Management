'use client';

import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import ResourcePage, { rowToForm } from '@/components/ui/resource-page';
import { Badge } from '@/components/ui';
import FileLink from '@/components/ui/file-link';
import { fileProblem } from '@/lib/validation';
import { fmtDateTime, toLocalInput } from '@/lib/format';

const assignmentFields = [
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
  {
    name: 'sections',
    label: 'Sections (optional)',
    type: 'multiselect',
    optionsUrl: '/sections',
    optionLabel: (s) => `${s.program?.code || ''} · ${s.name} · Sem ${s.semester}`,
    hint: 'Leave empty for all sections',
  },
  { name: 'deadline', label: 'Deadline', type: 'datetime-local', required: true },
  { name: 'maxMarks', label: 'Maximum marks', type: 'number', min: 1, max: 1000, required: true },
  { name: 'description', label: 'Description', type: 'textarea', maxLength: 5000 },
  {
    name: 'attachment',
    label: 'Attachment (optional)',
    type: 'file',
    hint: 'PDF, Office, image, text or zip — max 10 MB',
    validate: (f) => fileProblem(f),
  },
];

const STATUS_OPTS = ['pending', 'submitted', 'late', 'evaluated', 'overdue'].map((s) => ({
  value: s,
  label: s[0].toUpperCase() + s.slice(1),
}));

export default function Assignments() {
  const { user } = useAuth();
  const isStudent = user.role === 'student';
  return (
    <ResourcePage
      title="Assignments"
      subtitle={isStudent ? 'View assignments, download resources and submit your work' : 'Create assignments and evaluate submissions'}
      endpoint="/assignments"
      entity="assignment"
      createLabel="New assignment"
      defaultSort="-deadline"
      searchPlaceholder="Search title…"
      modalSize="lg"
      fields={isStudent ? [] : assignmentFields}
      toForm={(row) => ({
        ...rowToForm(
          row,
          assignmentFields.filter((f) => f.type !== 'file' && f.name !== 'deadline')
        ),
        deadline: toLocalInput(row.deadline),
      })}
      toPayload={(v) => ({ ...v, deadline: new Date(v.deadline).toISOString() })}
      canCreate={!isStudent}
      filters={[
        { name: 'subject', label: 'Subject', optionsUrl: '/subjects', optionsParams: { mine: 'true' }, optionLabel: (s) => s.code },
        ...(isStudent ? [{ name: 'status', label: 'Status', options: STATUS_OPTS }] : []),
      ]}
      columns={[
        {
          key: 'title',
          label: 'Title',
          sortKey: 'title',
          render: (r) => (
            <Link href={`/assignments/${r._id}`} className="strong">
              {r.title}
            </Link>
          ),
        },
        { key: 'subject', label: 'Subject', render: (r) => r.subject?.code },
        { key: 'deadline', label: 'Deadline', sortKey: 'deadline', render: (r) => fmtDateTime(r.deadline) },
        { key: 'maxMarks', label: 'Marks', render: (r) => r.maxMarks },
        { key: 'attachment', label: 'Resource', render: (r) => <FileLink file={r.attachment} label="Download" /> },
        ...(isStudent
          ? [
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge value={r.submissionStatus} tone={r.submissionStatus === 'overdue' ? 'danger' : undefined} />,
              },
            ]
          : []),
      ]}
      rowActions={(r) => (
        <Link className="btn btn-sm" href={`/assignments/${r._id}`}>
          {isStudent ? 'Open' : 'Submissions'}
        </Link>
      )}
    />
  );
}
