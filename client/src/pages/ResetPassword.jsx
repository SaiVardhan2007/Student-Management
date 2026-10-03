import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, fieldErrors } from '../api/client.js';
import { Button, Field } from '../components/ui.jsx';
import { passwordProblem } from '../utils/validation.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    const p = passwordProblem(form.newPassword);
    if (p) found.newPassword = p;
    if (form.confirm !== form.newPassword) found.confirm = 'Passwords do not match';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, newPassword: form.newPassword });
      toast.success('Password reset. Please sign in.');
      navigate('/login', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit} noValidate>
        <div><h1>Choose a new password</h1></div>
        {!token && <div className="form-error-summary" role="alert">This reset link is missing its token. Request a new link.</div>}
        {error && <div className="form-error-summary" role="alert">{error}</div>}
        <Field label="New password" htmlFor="np" error={errors.newPassword} hint="8+ characters with upper, lower case and a number">
          <input id="np" className="input" type="password" autoComplete="new-password" value={form.newPassword} aria-invalid={!!errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm password" htmlFor="cp" error={errors.confirm}>
          <input id="cp" className="input" type="password" autoComplete="new-password" value={form.confirm} aria-invalid={!!errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!token}>Reset password</Button>
        <p className="small" style={{ textAlign: 'center' }}><Link to="/forgot-password">Request a new link</Link></p>
      </form>
    </div>
  );
}
