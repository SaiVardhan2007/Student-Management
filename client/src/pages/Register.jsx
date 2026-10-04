import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { errorMessage } from '../api/client.js';
import { Button, Field } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

export default function Register() {
  const { register } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Full name is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) found.email = 'Enter a valid email address';
    if (form.password.length < 8) found.password = 'Password must be at least 8 characters';
    else if (!/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/[0-9]/.test(form.password))
      found.password = 'Use upper and lower case letters and a number';
    if (form.confirm !== form.password) found.confirm = 'Passwords do not match';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError('');
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to create the account. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit} noValidate>
        <div>
          <span className="brand-logo" style={{ color: '#fff' }}>
            <Icon name="graduation" size={18} />
          </span>
          <h1>{settings.collegeName}</h1>
          <p className="muted">Create your student account.</p>
        </div>
        {error && (
          <div className="form-error-summary" role="alert">
            {error}
          </div>
        )}
        <Field label="Full name" htmlFor="name" error={errors.name}>
          <input
            id="name"
            className="input"
            autoComplete="name"
            value={form.name}
            aria-invalid={!!errors.name}
            onChange={set('name')}
            autoFocus
          />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={form.email}
            aria-invalid={!!errors.email}
            onChange={set('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            aria-invalid={!!errors.password}
            onChange={set('password')}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>
          <input
            id="confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            aria-invalid={!!errors.confirm}
            onChange={set('confirm')}
          />
        </Field>
        <Button type="submit" variant="primary" className="btn-block" loading={busy}>
          Create account
        </Button>
        <p className="small" style={{ textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
