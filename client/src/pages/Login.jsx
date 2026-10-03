import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { errorMessage } from '../api/client.js';
import { Button, Field } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

export default function Login() {
  const { login } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) found.email = 'Enter a valid email address';
    if (!form.password) found.password = 'Password is required';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError('');
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to sign in. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit} noValidate>
        <div>
          <span className="brand-logo" style={{ color: '#fff' }}><Icon name="graduation" size={18} /></span>
          <h1>{settings.collegeName}</h1>
          <p className="muted">Sign in to your account</p>
        </div>
        {error && <div className="form-error-summary" role="alert">{error}</div>}
        <Field label="Email" htmlFor="email" error={errors.email}>
          <input id="email" className="input" type="email" autoComplete="username" value={form.email} aria-invalid={!!errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <input id="password" className="input" type="password" autoComplete="current-password" value={form.password} aria-invalid={!!errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Button type="submit" variant="primary" className="btn-block" loading={busy}>Sign in</Button>
        <p className="small" style={{ textAlign: 'center' }}><Link to="/forgot-password">Forgot your password?</Link></p>
        <p className="small" style={{ textAlign: 'center' }}>New student? <Link to="/register">Create an account</Link></p>
      </form>
    </div>
  );
}
