'use client';

// Registration page for students (admission number) and faculty (needs admin approval). Validates first; the API checks again.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useSettings } from '@/components/providers/settings-provider';
import { errorMessage } from '@/lib/api-client';
import { Alert, Button, Field } from '@/components/ui';
import Icon from '@/components/ui/icon';

export default function Register() {
  const { register } = useAuth();
  const { settings } = useSettings();
  const router = useRouter();
  const [form, setForm] = useState({ accountType: 'student', name: '', admissionNumber: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<any>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const isStudent = form.accountType === 'student';
  // Returns an onChange handler that updates one field of the form, e.g. onChange={set('name')}
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const found: Record<string, any> = {};
    if (isStudent && !form.admissionNumber.trim()) found.admissionNumber = 'Admission number is required';
    if (!isStudent && form.name.trim().length < 2) found.name = 'Full name is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) found.email = 'Enter a valid email address';
    const hasLower = /[a-z]/.test(form.password);
    const hasUpper = /[A-Z]/.test(form.password);
    const hasDigit = /[0-9]/.test(form.password);
    if (form.password.length < 8) {
      found.password = 'Password must be at least 8 characters';
    } else if (!hasLower || !hasUpper || !hasDigit) {
      found.password = 'Use upper and lower case letters and a number';
    }
    if (form.confirm !== form.password) found.confirm = 'Passwords do not match';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await register({
        accountType: form.accountType,
        name: isStudent ? undefined : form.name.trim(),
        admissionNumber: isStudent ? form.admissionNumber.trim() : undefined,
        email: form.email.trim(),
        password: form.password,
      });
      if (result?.pending) setPending(result.message);
      else router.replace('/');
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
          <p className="muted">Create your account.</p>
        </div>
        {pending && <Alert tone="success">{pending}</Alert>}
        {error && (
          <div className="form-error-summary" role="alert">
            {error}
          </div>
        )}
        <Field label="I am a" htmlFor="accountType">
          <select id="accountType" className="input" value={form.accountType} onChange={set('accountType')}>
            <option value="student">Student</option>
            <option value="faculty">Faculty (needs admin approval)</option>
          </select>
        </Field>
        {isStudent ? (
          <Field label="Admission number" htmlFor="admissionNumber" error={errors.admissionNumber}>
            <input
              id="admissionNumber"
              className="input"
              value={form.admissionNumber}
              aria-invalid={!!errors.admissionNumber}
              onChange={set('admissionNumber')}
              autoFocus
            />
          </Field>
        ) : (
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
        )}
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
        <Button type="submit" variant="primary" className="btn-block" loading={busy} disabled={!!pending}>
          {isStudent ? 'Create account' : 'Request approval'}
        </Button>
        <p className="small" style={{ textAlign: 'center' }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
