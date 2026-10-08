'use client';

// Forgot-password page: asks for an email and requests a reset link from the API.

import { useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api-client';
import { Alert, Button, Field } from '@/components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim(), admissionNumber: admissionNumber.trim() || undefined });
      setResult(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit} noValidate>
        <div>
          <h1>Reset your password</h1>
          <p className="muted">Enter your account email (and your admission number if you are a student) and we&apos;ll email you a reset link.</p>
        </div>
        {error && (
          <div className="form-error-summary" role="alert">
            {error}
          </div>
        )}
        {result ? (
          <>
            <Alert tone="success">{result.message}</Alert>
            {result.data?.resetLink && (
              <Alert tone="info">
                <strong>Development mode:</strong> SMTP is not configured, so the link is shown here (and printed in the API console).
                <div style={{ marginTop: 6, wordBreak: 'break-all' }}>
                  <a href={result.data.resetLink}>{result.data.resetLink}</a>
                </div>
              </Alert>
            )}
            {!result.data?.resetLink && (
              <p className="small muted">
                Check your inbox (and spam folder). The link is valid for 30 minutes.
              </p>
            )}
          </>
        ) : (
          <>
            <Field label="Email" htmlFor="fp-email">
              <input id="fp-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Field label="Admission number (students)" htmlFor="fp-admission">
              <input id="fp-admission" className="input" value={admissionNumber} onChange={(e) => setAdmissionNumber(e.target.value)} />
            </Field>
            <p className="small muted">If you no longer have access to your email, ask the administrator to update it on your student record.</p>
            <Button type="submit" variant="primary" loading={busy}>
              Send reset link
            </Button>
          </>
        )}
        <p className="small" style={{ textAlign: 'center' }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
