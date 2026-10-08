'use client';

// Admin-only user accounts page. Admin can add admin/parent accounts, activate or deactivate accounts
// and reset passwords. Student and faculty accounts are created from their own pages. Uses the /users API.

import { useState } from 'react';
import toast from 'react-hot-toast';
import ResourcePage from '@/components/ui/resource-page';
import { Alert, Badge, Button, Modal } from '@/components/ui';
import { RowAction } from '@/components/ui/data-table';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { api, errorMessage } from '@/lib/api-client';
import DynamicForm from '@/components/ui/dynamic-form';
import { fmtDateTime } from '@/lib/format';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'student', label: 'Student' },
  { value: 'parent', label: 'Parent' },
];

export default function Users() {
  const { user: me } = useAuth();
  const confirm = useConfirm();
  // Holds the user and temporary password to show in the popup (new account or password reset)
  const [temp, setTemp] = useState(null);
  // Pending faculty request being approved (needs an employee id and department), and a reload callback for after
  const [approving, setApproving] = useState<any>(null);

  const reject = async (u, reload) => {
    const confirmed = await confirm({
      title: 'Reject request?',
      message: `${u.name} (${u.email}) will not be able to sign in.`,
      confirmLabel: 'Reject',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.post(`/users/${u._id}/reject`);
      toast.success('Request rejected');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggle = async (u, reload) => {
    const next = !u.isActive;
    const confirmed = await confirm({
      title: `${next ? 'Activate' : 'Deactivate'} account?`,
      message: `${u.name} (${u.email}) will ${next ? 'be able to' : 'no longer be able to'} sign in.`,
      confirmLabel: next ? 'Activate' : 'Deactivate',
      danger: !next,
    });
    if (!confirmed) return;
    try {
      await api.patch(`/users/${u._id}`, { isActive: next });
      toast.success(`Account ${next ? 'activated' : 'deactivated'}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const resetPw = async (u) => {
    const confirmed = await confirm({
      title: 'Reset password?',
      message: `Generate a new temporary password for ${u.name}? Their current password stops working immediately.`,
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const r = await api.post(`/users/${u._id}/reset-password`);
      setTemp({ user: u, password: r.data.data.temporaryPassword });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <ResourcePage
        title="User accounts"
        subtitle="Manage sign-in accounts, roles and access. Students and faculty are created from their own pages; new faculty sign-ups appear here for approval."
        endpoint="/users"
        entity="user"
        createLabel="Add admin / parent"
        searchPlaceholder="Search name or email…"
        deletable={false}
        defaultSort="name"
        defaults={{ role: 'parent' }}
        fields={[
          { name: 'name', label: 'Full name', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          {
            name: 'role',
            label: 'Role',
            type: 'select',
            required: true,
            options: ROLES.filter((r) => ['admin', 'parent'].includes(r.value)),
          },
          {
            name: 'children',
            label: 'Linked students (parents)',
            type: 'multiselect',
            optionsUrl: '/students',
            optionLabel: (s) => `${s.studentId} — ${s.firstName} ${s.lastName}`,
            show: (v) => v.role === 'parent',
            hint: 'Hold Ctrl/Cmd to select several',
          },
        ]}
        // Students and faculty are edited on their own pages
        canEdit={(u) => !['student', 'faculty'].includes(u.role)}
        onSaved={(d) => d?.temporaryPassword && setTemp({ user: d.user, password: d.temporaryPassword })}
        filters={[
          { name: 'role', label: 'Role', options: ROLES },
          {
            name: 'approvalStatus',
            label: 'Approval',
            options: [
              { value: 'pending', label: 'Pending approval' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ],
          },
          {
            name: 'isActive',
            label: 'State',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
        ]}
        columns={[
          {
            key: 'name',
            label: 'Name',
            sortKey: 'name',
            render: (u) => (
              <span className="strong">
                {u.name}
                {u._id === me._id && <span className="faint"> (you)</span>}
              </span>
            ),
          },
          { key: 'email', label: 'Email', sortKey: 'email' },
          { key: 'role', label: 'Role', sortKey: 'role', render: (u) => <Badge tone="primary">{u.role}</Badge> },
          {
            key: 'isActive',
            label: 'State',
            render: (u) =>
              u.approvalStatus === 'pending' ? (
                <Badge tone="warning">Pending approval</Badge>
              ) : u.approvalStatus === 'rejected' ? (
                <Badge tone="danger">Rejected</Badge>
              ) : (
                <Badge tone={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
              ),
          },
          { key: 'lastLoginAt', label: 'Last login', sortKey: 'lastLoginAt', render: (u) => fmtDateTime(u.lastLoginAt) },
        ]}
        rowActions={(u, reload) => (
          <>
            {u.approvalStatus === 'pending' && (
              <>
                <RowAction icon="check" label="Approve faculty" onClick={() => setApproving({ user: u, reload })} />
                <RowAction icon="x" label="Reject request" danger onClick={() => reject(u, reload)} />
              </>
            )}
            {u.approvalStatus !== 'pending' && <RowAction icon="key" label="Reset password" onClick={() => resetPw(u)} />}
            {/* An admin cannot deactivate their own account */}
            {u._id !== me._id && u.approvalStatus === 'approved' && (
              <RowAction
                icon={u.isActive ? 'x' : 'check'}
                label={u.isActive ? 'Deactivate account' : 'Activate account'}
                danger={u.isActive}
                onClick={() => toggle(u, reload)}
              />
            )}
          </>
        )}
      />
      {approving && (
        <Modal title={`Approve ${approving.user.name}`} onClose={() => setApproving(null)} size="sm">
          <p className="muted small">Creating the faculty profile for {approving.user.email}.</p>
          <DynamicForm
            fields={[
              { name: 'employeeId', label: 'Employee ID', required: true, maxLength: 40 },
              { name: 'department', label: 'Department', type: 'select', required: true, optionsUrl: '/departments' },
              { name: 'designation', label: 'Designation', maxLength: 100 },
            ]}
            submitLabel="Approve"
            onCancel={() => setApproving(null)}
            onSubmit={async (values) => {
              try {
                await api.post(`/users/${approving.user._id}/approve`, values);
                toast.success('Faculty approved');
                approving.reload();
                setApproving(null);
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
        </Modal>
      )}
      {temp && (
        <Modal
          title="Temporary password"
          onClose={() => setTemp(null)}
          size="sm"
          footer={
            <Button variant="primary" onClick={() => setTemp(null)}>
              Done
            </Button>
          }
        >
          <Alert tone="warning">
            Shown <strong>only once</strong>. The user must change it at next login.
          </Alert>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Account</dt>
            <dd>{temp.user.email}</dd>
            <dt>Password</dt>
            <dd>
              <code style={{ fontSize: 15 }}>{temp.password}</code>
            </dd>
          </dl>
        </Modal>
      )}
    </>
  );
}
