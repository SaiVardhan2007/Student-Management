'use client';

import { useAuth } from '@/components/providers/auth-provider';
import ResourcePage from '@/components/ui/resource-page';
import { Badge } from '@/components/ui';
import FileLink from '@/components/ui/file-link';
import { fmtDate } from '@/lib/format';
import { fileProblem } from '@/lib/validation';

const AUDIENCE = [
  { value: 'all', label: 'Everyone' },
  { value: 'students', label: 'Students' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'parents', label: 'Parents' },
];
const PRIORITY = ['low', 'normal', 'high', 'urgent'].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }));

export default function Notices() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const isFaculty = user.role === 'faculty';
  const canPost = isAdmin || isFaculty;

  const fields = canPost
    ? [
        { name: 'title', label: 'Title', required: true, maxLength: 200, span2: true },
        { name: 'description', label: 'Description', type: 'textarea', rows: 5, required: true, maxLength: 5000 },
        ...(isAdmin
          ? [
              { name: 'audience', label: 'Audience', type: 'select', options: AUDIENCE, required: true },
              { name: 'department', label: 'Department (optional)', type: 'select', optionsUrl: '/departments' },
              { name: 'program', label: 'Program (optional)', type: 'select', optionsUrl: '/programs' },
              {
                name: 'year',
                label: 'Year of study (optional)',
                type: 'select',
                options: [1, 2, 3, 4].map((y) => ({ value: String(y), label: `Year ${y}` })),
              },
            ]
          : []),
        {
          name: 'section',
          label: isFaculty ? 'Class section' : 'Section (optional)',
          type: 'select',
          required: isFaculty,
          optionsUrl: '/sections',
          optionLabel: (s) => `${s.program?.code || ''} · ${s.name}${s.batch ? ` (${s.batch})` : ''} · Sem ${s.semester}`,
          hint: isFaculty ? 'You can publish to classes you teach' : undefined,
        },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY, required: true },
        { name: 'publishDate', label: 'Publish date', type: 'date' },
        { name: 'expiryDate', label: 'Expiry date', type: 'date' },
        {
          name: 'attachment',
          label: 'Attachment (optional)',
          type: 'file',
          validate: (f) => fileProblem(f),
          hint: 'PDF, image, Office file — max 10 MB',
        },
      ]
    : [];

  return (
    <ResourcePage
      title="Notices"
      subtitle={canPost ? 'Publish targeted announcements' : 'Announcements from your college'}
      endpoint="/notices"
      entity="notice"
      createLabel="Publish notice"
      defaultSort="-publishDate"
      searchPlaceholder="Search notices…"
      modalSize="lg"
      defaults={{ audience: isFaculty ? 'students' : 'all', priority: 'normal' }}
      fields={fields}
      canCreate={canPost}
      canEdit={(n) => isAdmin || n.createdBy?._id === user._id}
      canDelete={(n) => isAdmin || n.createdBy?._id === user._id}
      toForm={(n) => ({
        title: n.title,
        description: n.description,
        audience: n.audience,
        department: n.department?._id,
        program: n.program?._id,
        year: n.year ? String(n.year) : undefined,
        section: n.section?._id,
        priority: n.priority,
        publishDate: n.publishDate?.slice(0, 10),
        expiryDate: n.expiryDate?.slice(0, 10),
      })}
      filters={[{ name: 'priority', label: 'Priority', options: PRIORITY }]}
      columns={[
        {
          key: 'title',
          label: 'Notice',
          sortKey: 'title',
          render: (n) => (
            <div>
              <strong>{n.title}</strong>
              <div className="muted small" style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>
                {n.description.length > 220 ? `${n.description.slice(0, 220)}…` : n.description}
              </div>
              {n.attachment && <FileLink file={n.attachment} />}
            </div>
          ),
        },
        { key: 'priority', label: 'Priority', sortKey: 'priority', render: (n) => <Badge value={n.priority} /> },
        {
          key: 'audience',
          label: 'Audience',
          render: (n) => (
            <div>
              <Badge>{n.audience}</Badge>
              {(n.department || n.program || n.section || n.year) && (
                <div className="faint small">
                  {[n.department?.name, n.program?.name, n.year && `Year ${n.year}`, n.section && `Sec ${n.section.name}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>
          ),
        },
        { key: 'by', label: 'Posted by', render: (n) => n.createdBy?.name },
        { key: 'publishDate', label: 'Published', sortKey: 'publishDate', render: (n) => fmtDate(n.publishDate) },
        ...(canPost ? [{ key: 'expiryDate', label: 'Expires', render: (n) => fmtDate(n.expiryDate) }] : []),
      ]}
    />
  );
}
