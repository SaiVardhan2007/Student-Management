'use client';

// Student list. Admin can add, edit, deactivate/reactivate, import and export students.
// Faculty see students in their subjects and parents see their own children (read only).
// Uses the /students API through ResourcePage.

import { useState } from 'react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import ResourcePage from '@/components/ui/resource-page';
import { Avatar, Alert, Badge, Button, Modal } from '@/components/ui';
import { RowAction } from '@/components/ui/data-table';
import Icon from '@/components/ui/icon';
import { useConfirm } from '@/components/providers/confirm-provider';
import { api, downloadFrom, errorMessage } from '@/lib/api-client';
import { fmtDate } from '@/lib/format';
import { SEMESTERS, STATUSES } from '@/lib/constants';

const deptField = { name: 'department', label: 'Department', type: 'select', required: true, optionsUrl: '/departments' };
const programField = {
  name: 'program',
  label: 'Program',
  type: 'select',
  required: true,
  optionsUrl: '/programs',
  filterOptions: (opts, v) => (v.department ? opts.filter((o) => (o.raw.department?._id || o.raw.department) === v.department) : opts),
};
const sectionField = {
  name: 'section',
  label: 'Section',
  type: 'select',
  optionsUrl: '/sections',
  optionLabel: (s) => `${s.program?.code || ''} · ${s.name}${s.batch ? ` (${s.batch})` : ''} · Sem ${s.semester}`,
  filterOptions: (opts, v) => (v.program ? opts.filter((o) => (o.raw.program?._id || o.raw.program) === v.program) : opts),
};

const studentFields = [
  { section: 'Personal details' },
  { name: 'studentId', label: 'Student ID', required: true, maxLength: 30 },
  { name: 'firstName', label: 'First name', required: true, maxLength: 60 },
  { name: 'lastName', label: 'Last name', required: true, maxLength: 60 },
  { name: 'email', label: 'Email', type: 'email', required: true, hint: 'Also used as the login username' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  {
    name: 'gender',
    label: 'Gender',
    type: 'select',
    options: [
      { value: 'male', label: 'Male' },
      { value: 'female', label: 'Female' },
      { value: 'other', label: 'Other' },
    ],
  },
  { section: 'Academic details' },
  deptField,
  programField,
  { name: 'batch', label: 'Batch', placeholder: 'e.g. 2025' },
  { name: 'admissionYear', label: 'Admission year', type: 'number', min: 1990, max: 2100 },
  { name: 'semester', label: 'Current semester', type: 'select', options: SEMESTERS, required: true },
  sectionField,
  { name: 'admissionDate', label: 'Admission date', type: 'date' },
  { name: 'status', label: 'Status', type: 'select', options: STATUSES, required: true },
  { section: 'Guardian & emergency contact' },
  { name: 'guardian.name', label: 'Guardian name' },
  { name: 'guardian.relation', label: 'Relation' },
  { name: 'guardian.phone', label: 'Guardian phone', type: 'tel' },
  { name: 'guardian.email', label: 'Guardian email', type: 'email' },
  { name: 'emergencyContact.name', label: 'Emergency contact name' },
  { name: 'emergencyContact.phone', label: 'Emergency contact phone', type: 'tel' },
  { section: 'Address' },
  { name: 'address.line1', label: 'Address line 1', span2: true },
  { name: 'address.city', label: 'City' },
  { name: 'address.state', label: 'State' },
  { name: 'address.pincode', label: 'PIN / ZIP' },
];

// Shown once after a student is created, because the temporary password cannot be viewed again.
function CredentialsModal({ info, onClose }: any) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.temporaryPassword);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed — select and copy manually.');
    }
  };
  return (
    <Modal
      title="Student created"
      onClose={onClose}
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <Alert tone="warning">
        Share this temporary password with the student securely. It is shown <strong>only once</strong>; they must change it at first login.
      </Alert>
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Login</dt>
        <dd>{info.student.email}</dd>
        <dt>Temporary password</dt>
        <dd>
          <code style={{ fontSize: 15 }}>{info.temporaryPassword}</code>{' '}
          <Button size="sm" onClick={copy}>
            Copy
          </Button>
        </dd>
      </dl>
    </Modal>
  );
}

export default function Students() {
  const { user } = useAuth();
  const confirm = useConfirm();
  // Holds the new student's login details until the admin closes the credentials popup
  const [creds, setCreds] = useState(null);
  const isAdmin = user.role === 'admin';
  const isParent = user.role === 'parent';

  let subtitle = 'Students enrolled in your subjects';
  if (isAdmin) subtitle = 'Manage student records, enrolment and status';
  if (isParent) subtitle = 'Students linked to your account';

  // exports what the table currently shows: the same search text and filters
  const exportCsv = async (params) => {
    try {
      await downloadFrom('/students/export', params, 'students.csv');
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to export students.'));
    }
  };

  const activate = async (row, reload) => {
    const confirmed = await confirm({
      title: 'Reactivate student?',
      message: `${row.firstName} ${row.lastName} will be able to log in again.`,
      confirmLabel: 'Reactivate',
    });
    if (!confirmed) return;
    try {
      await api.post(`/students/${row._id}/activate`);
      toast.success('Student reactivated');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <ResourcePage
        title={isParent ? 'My children' : 'Students'}
        subtitle={subtitle}
        endpoint="/students"
        entity="student"
        createLabel="Add student"
        searchPlaceholder="Search name, ID, email…"
        defaultSort="studentId"
        fields={isAdmin ? studentFields : []}
        defaults={{ status: 'active', semester: '1' }}
        canCreate={isAdmin}
        canEdit={() => isAdmin}
        // Deleting only deactivates a student, so already inactive students cannot be deleted again
        canDelete={(r) => isAdmin && r.status !== 'inactive'}
        deleteMessage={(r) =>
          `Deactivate ${r.firstName} ${r.lastName}? Their login will be disabled but all records are kept. You can reactivate them later.`
        }
        modalSize="lg"
        limit={15}
        // Only a newly created student comes back with a temporary password
        onSaved={(d) => d?.temporaryPassword && setCreds(d)}
        headerActions={(list) =>
          isAdmin && (
            <>
              <Link className="btn" href="/import">
                Bulk import
              </Link>
              <Button icon="download" onClick={() => exportCsv(list.queryParams)}>
                Export CSV
              </Button>
            </>
          )
        }
        filters={[
          { name: 'department', label: 'Department', optionsUrl: '/departments' },
          { name: 'program', label: 'Program', optionsUrl: '/programs' },
          { name: 'semester', label: 'Semester', options: SEMESTERS },
          { name: 'status', label: 'Status', options: STATUSES },
        ]}
        columns={[
          {
            key: 'name',
            label: 'Student',
            sortKey: 'firstName',
            render: (r) => (
              <span className="row" style={{ flexWrap: 'nowrap' }}>
                <Avatar name={`${r.firstName} ${r.lastName}`} />
                <Link href={`/students/${r._id}`} className="strong">
                  {r.firstName} {r.lastName}
                </Link>
              </span>
            ),
          },
          { key: 'studentId', label: 'ID', sortKey: 'studentId' },
          { key: 'program', label: 'Program', render: (r) => r.program?.code || '—' },
          { key: 'semester', label: 'Sem', sortKey: 'semester' },
          { key: 'section', label: 'Section', render: (r) => r.section?.name || '—' },
          { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
          { key: 'status', label: 'Status', sortKey: 'status', render: (r) => <Badge value={r.status} /> },
          { key: 'createdAt', label: 'Added', sortKey: 'createdAt', render: (r) => fmtDate(r.createdAt) },
        ]}
        rowActions={(r, reload) => (
          <>
            <Link className="btn btn-ghost btn-icon btn-sm" href={`/students/${r._id}`} aria-label="View student" title="View">
              <Icon name="eye" size={16} />
            </Link>
            {isAdmin && r.status === 'inactive' && (
              <RowAction icon="refresh" label="Reactivate student" onClick={() => activate(r, reload)} />
            )}
          </>
        )}
      />
      {creds && <CredentialsModal info={creds} onClose={() => setCreds(null)} />}
    </>
  );
}
