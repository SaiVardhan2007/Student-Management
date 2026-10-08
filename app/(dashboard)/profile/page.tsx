'use client';

// Profile for every role: basic details and change password. Students can also upload a photo
// and edit contact and guardian details. Uses /auth/change-password and /students/me.

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage, fetchImageUrl, sessionHint } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { useFetch } from '@/hooks';
import DynamicForm from '@/components/ui/dynamic-form';
import { Alert, Avatar, Badge, Button, Card, Field, PageHeader } from '@/components/ui';
import { fileProblem, passwordProblem } from '@/lib/validation';
import { fmtDateTime } from '@/lib/format';

// Change-password form. Validation runs in the browser first; the server checks the current password.
function ChangePassword() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<any>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Returns an onChange handler for one field, and clears that field's error while typing
  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setErrors({ ...errors, [k]: undefined });
  };

  const submit = async (e) => {
    e.preventDefault();
    const found: Record<string, any> = {};
    if (!form.currentPassword) found.currentPassword = 'Enter your current password';
    const p = passwordProblem(form.newPassword);
    if (p) found.newPassword = p;
    if (form.newPassword === form.currentPassword) found.newPassword = 'New password must differ from the current one';
    if (form.confirm !== form.newPassword) found.confirm = 'Passwords do not match';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      sessionHint.set(); // the server re-issued this session's cookies after the password change
      setUser({ ...user, mustChangePassword: false });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Other sessions were signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Change password">
      <form className="stack" onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
        {user.mustChangePassword && <Alert tone="warning">You are using a temporary password. Please choose your own now.</Alert>}
        {error && (
          <div className="form-error-summary" role="alert">
            {error}
          </div>
        )}
        <Field label="Current password" htmlFor="cur" error={errors.currentPassword}>
          <input
            id="cur"
            className="input"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={set('currentPassword')}
            aria-invalid={!!errors.currentPassword}
          />
        </Field>
        <Field label="New password" htmlFor="new" error={errors.newPassword} hint="8+ characters with upper, lower case and a number">
          <input
            id="new"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={set('newPassword')}
            aria-invalid={!!errors.newPassword}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="conf" error={errors.confirm}>
          <input
            id="conf"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            aria-invalid={!!errors.confirm}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

// Photo and contact details, shown to students only.
function StudentProfile() {
  const { data: s, loading, reload } = useFetch('/students/me');
  const [photo, setPhoto] = useState(null);
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  // Download the photo as a temporary browser URL, and free it when the photo changes or the page closes.
  useEffect(() => {
    let url;
    if (s?.photo) {
      fetchImageUrl(s.photo)
        .then((u) => {
          url = u;
          setPhoto(u);
        })
        .catch(() => {}); // no photo shown if loading fails; the Avatar falls back to initials
    }
    return () => url && URL.revokeObjectURL(url);
  }, [s?.photo]);

  if (loading || !s) return null;

  const upload = async (file) => {
    const problem = fileProblem(file, { exts: ['png', 'jpg', 'jpeg'], maxMb: 2 });
    if (problem) return toast.error(problem);
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      await api.post('/students/me/photo', fd);
      toast.success('Photo updated');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Profile photo">
        <div className="row">
          <Avatar name={`${s.firstName} ${s.lastName}`} src={photo} size="lg" />
          <input
            ref={ref}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
          />
          <Button icon="upload" loading={busy} onClick={() => ref.current?.click()}>
            Change photo
          </Button>
          <span className="small muted">PNG or JPG, max 2 MB</span>
        </div>
      </Card>
      <Card title="Contact & guardian details">
        <p className="muted small" style={{ marginBottom: 12 }}>
          Academic details (department, program, semester, status) can only be changed by the administrator.
        </p>
        <DynamicForm
          initial={{
            phone: s.phone || '',
            address: s.address || {},
            guardian: s.guardian || {},
            emergencyContact: s.emergencyContact || {},
          }}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await api.patch('/students/me', v);
            toast.success('Profile updated');
            reload();
          }}
          fields={[
            { name: 'phone', label: 'Phone', type: 'tel' },
            { name: 'address.line1', label: 'Address', span2: true },
            { name: 'address.city', label: 'City' },
            { name: 'address.state', label: 'State' },
            { name: 'address.pincode', label: 'PIN / ZIP' },
            { section: 'Guardian' },
            { name: 'guardian.name', label: 'Name' },
            { name: 'guardian.relation', label: 'Relation' },
            { name: 'guardian.phone', label: 'Phone', type: 'tel' },
            { name: 'guardian.email', label: 'Email', type: 'email' },
            { section: 'Emergency contact' },
            { name: 'emergencyContact.name', label: 'Name' },
            { name: 'emergencyContact.phone', label: 'Phone', type: 'tel' },
          ]}
        />
      </Card>
    </>
  );
}

export default function Profile() {
  const { user, profile } = useAuth();
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHeader title="My profile" />
      <Card>
        <div className="row">
          <Avatar name={user.name} size="lg" />
          <div>
            <h2>{user.name}</h2>
            <p className="muted">{user.email}</p>
            <div className="row" style={{ marginTop: 4 }}>
              <Badge tone="primary">{user.role}</Badge>
              {profile?.studentId && <Badge>{profile.studentId}</Badge>}
              {profile?.employeeId && <Badge>{profile.employeeId}</Badge>}
            </div>
          </div>
        </div>
        <p className="faint small" style={{ marginTop: 10 }}>
          Last sign-in: {fmtDateTime(user.lastLoginAt)}
        </p>
      </Card>
      {user.role === 'student' && <StudentProfile />}
      <ChangePassword />
    </div>
  );
}
