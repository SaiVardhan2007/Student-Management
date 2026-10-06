'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import ResourcePage from '@/components/ui/resource-page';
import DynamicForm from '@/components/ui/dynamic-form';
import { Alert, Badge, Button, Modal } from '@/components/ui';
import { RowAction } from '@/components/ui/data-table';
import { useConfirm } from '@/components/providers/confirm-provider';
import { api, downloadFrom, errorMessage } from '@/lib/api-client';
import { useFetch } from '@/hooks';
import { fmtDate } from '@/lib/format';

const FIELDS = [
  { name: 'employeeId', label: 'Employee ID', required: true, maxLength: 30 },
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true, hint: 'Also used as the login username' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'department', label: 'Department', type: 'select', required: true, optionsUrl: '/departments' },
  { name: 'designation', label: 'Designation', placeholder: 'e.g. Assistant Professor' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: [
      { value: 'active', label: 'Active' },
      { value: 'on_leave', label: 'On leave' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
  { name: 'joiningDate', label: 'Joining date', type: 'date' },
];

function AssignSubjects({ faculty, onClose, onDone }: any) {
  const current = useFetch(`/faculty/${faculty._id}`);
  const fields = [
    {
      name: 'subjects',
      label: 'Subjects taught',
      type: 'multiselect',
      optionsUrl: '/subjects',
      optionLabel: (s) =>
        `${s.code} — ${s.name} (Sem ${s.semester}${s.faculty && s.faculty._id !== faculty._id ? `, currently ${s.faculty.firstName} ${s.faculty.lastName}` : ''})`,
      hint: 'Hold Ctrl/Cmd to select several. Selected subjects are reassigned to this faculty member.',
    },
  ];
  if (current.loading)
    return (
      <Modal title="Assign subjects" onClose={onClose}>
        <p>Loading…</p>
      </Modal>
    );
  return (
    <Modal title={`Assign subjects — ${faculty.firstName} ${faculty.lastName}`} onClose={onClose} size="lg">
      <DynamicForm
        fields={fields}
        initial={{ subjects: (current.data?.subjects || []).map((s) => s._id) }}
        submitLabel="Save assignment"
        onCancel={onClose}
        onSubmit={async (v) => {
          await api.put(`/faculty/${faculty._id}/subjects`, { subjects: v.subjects || [] });
          toast.success('Subjects assigned');
          onDone();
          onClose();
        }}
      />
    </Modal>
  );
}

export default function Faculty() {
  const [assign, setAssign] = useState(null);
  const [creds, setCreds] = useState(null);
  const confirm = useConfirm();

  const activate = async (row, reload) => {
    if (
      !(await confirm({
        title: 'Activate faculty member?',
        message: `${row.firstName} ${row.lastName} will be able to log in again.`,
        confirmLabel: 'Activate',
      }))
    )
      return;
    try {
      await api.post(`/faculty/${row._id}/activate`);
      toast.success('Faculty activated');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <ResourcePage
        title="Faculty"
        subtitle="Manage faculty profiles, departments and teaching assignments"
        endpoint="/faculty"
        entity="faculty member"
        createLabel="Add faculty"
        fields={FIELDS}
        defaults={{ status: 'active' }}
        defaultSort="employeeId"
        deleteMessage={(r) => `Deactivate ${r.firstName} ${r.lastName}? Their login will be disabled. Existing records are kept.`}
        canDelete={(r) => r.status !== 'inactive'}
        onSaved={(d) => d?.temporaryPassword && setCreds({ email: d.faculty.email, password: d.temporaryPassword })}
        searchPlaceholder="Search name, ID, email…"
        headerActions={
          <Button
            icon="download"
            onClick={() => downloadFrom('/faculty/export', {}, 'faculty.csv').catch((e) => toast.error(errorMessage(e)))}
          >
            Export CSV
          </Button>
        }
        filters={[
          { name: 'department', label: 'Department', optionsUrl: '/departments' },
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'on_leave', label: 'On leave' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
        ]}
        columns={[
          {
            key: 'name',
            label: 'Name',
            sortKey: 'firstName',
            render: (r) => (
              <span className="strong">
                {r.firstName} {r.lastName}
              </span>
            ),
          },
          { key: 'employeeId', label: 'Employee ID', sortKey: 'employeeId' },
          { key: 'department', label: 'Department', render: (r) => r.department?.code || '—' },
          { key: 'designation', label: 'Designation', render: (r) => r.designation || '—' },
          { key: 'email', label: 'Email' },
          { key: 'joiningDate', label: 'Joined', sortKey: 'joiningDate', render: (r) => fmtDate(r.joiningDate) },
          { key: 'status', label: 'Status', sortKey: 'status', render: (r) => <Badge value={r.status} /> },
        ]}
        rowActions={(r, reload) => (
          <>
            <RowAction icon="book" label="Assign subjects" onClick={() => setAssign({ faculty: r, reload })} />
            {r.status === 'inactive' && <RowAction icon="refresh" label="Activate faculty" onClick={() => activate(r, reload)} />}
          </>
        )}
      />
      {assign && <AssignSubjects faculty={assign.faculty} onClose={() => setAssign(null)} onDone={assign.reload} />}
      {creds && (
        <Modal
          title="Faculty created"
          onClose={() => setCreds(null)}
          size="sm"
          footer={
            <Button variant="primary" onClick={() => setCreds(null)}>
              Done
            </Button>
          }
        >
          <Alert tone="warning">
            Share this temporary password securely. It is shown <strong>only once</strong>.
          </Alert>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Login</dt>
            <dd>{creds.email}</dd>
            <dt>Temporary password</dt>
            <dd>
              <code style={{ fontSize: 15 }}>{creds.password}</code>
            </dd>
          </dl>
        </Modal>
      )}
    </>
  );
}
