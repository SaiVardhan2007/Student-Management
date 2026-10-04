import { useState } from 'react';
import toast from 'react-hot-toast';
import ResourcePage from '../components/ResourcePage.jsx';
import { Alert, Badge, Button, Modal } from '../components/ui.jsx';
import { RowAction } from '../components/DataTable.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api, errorMessage } from '../api/client.js';
import { fmtDateTime } from '../utils/format.js';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'student', label: 'Student' },
  { value: 'parent', label: 'Parent' },
];

export default function Users() {
  const { user: me } = useAuth();
  const confirm = useConfirm();
  const [temp, setTemp] = useState(null);

  const toggle = async (u, reload) => {
    const next = !u.isActive;
    if (
      !(await confirm({
        title: `${next ? 'Activate' : 'Deactivate'} account?`,
        message: `${u.name} (${u.email}) will ${next ? 'be able to' : 'no longer be able to'} sign in.`,
        confirmLabel: next ? 'Activate' : 'Deactivate',
        danger: !next,
      }))
    )
      return;
    try {
      await api.patch(`/users/${u._id}`, { isActive: next });
      toast.success(`Account ${next ? 'activated' : 'deactivated'}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const resetPw = async (u) => {
    if (
      !(await confirm({
        title: 'Reset password?',
        message: `Generate a new temporary password for ${u.name}? Their current password stops working immediately.`,
        confirmLabel: 'Reset',
        danger: true,
      }))
    )
      return;
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
        subtitle="Manage sign-in accounts, roles and access. Students and faculty are created from their own pages."
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
        canEdit={(u) => !['student', 'faculty'].includes(u.role)}
        onSaved={(d) => d?.temporaryPassword && setTemp({ user: d.user, password: d.temporaryPassword })}
        filters={[
          { name: 'role', label: 'Role', options: ROLES },
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
            render: (u) => <Badge tone={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>,
          },
          { key: 'lastLoginAt', label: 'Last login', sortKey: 'lastLoginAt', render: (u) => fmtDateTime(u.lastLoginAt) },
        ]}
        rowActions={(u, reload) => (
          <>
            <RowAction icon="key" label="Reset password" onClick={() => resetPw(u)} />
            {u._id !== me._id && (
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
