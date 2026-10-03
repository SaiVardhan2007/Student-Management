import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address');
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim() });
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
        <div><h1>Reset your password</h1><p className="muted">Enter your account email and we'll generate a reset link.</p></div>
        {error && <div className="form-error-summary" role="alert">{error}</div>}
        {result ? (
          <>
            <Alert tone="success">{result.message}</Alert>
            {result.data?.resetLink && (
              <Alert tone="info">
                <strong>Development mode:</strong> no email server is configured, so the link is shown here (and printed in the API console).
                <div style={{ marginTop: 6, wordBreak: 'break-all' }}><a href={result.data.resetLink}>{result.data.resetLink}</a></div>
              </Alert>
            )}
            {!result.data?.resetLink && <p className="small muted">Without an email server configured, the link is written to the API server console — ask your administrator.</p>}
          </>
        ) : (
          <>
            <Field label="Email" htmlFor="fp-email"><input id="fp-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
            <Button type="submit" variant="primary" loading={busy}>Send reset link</Button>
          </>
        )}
        <p className="small" style={{ textAlign: 'center' }}><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  );
}
