import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import FileLink from '../components/FileLink.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { SettingsProvider } from '../context/SettingsContext.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { api, tokenStore } from '../api/client.js';

const ok = (data, message = 'OK') => ({ data: { success: true, message, data }, status: 200, statusText: 'OK', headers: {} });
const fail = (status, message) => Promise.reject({ response: { status, data: { success: false, message } } });

let handlers;
let seen;
beforeEach(() => {
  localStorage.clear();
  tokenStore.clear();
  seen = [];
  handlers = { 'GET /settings/public': () => ok({ collegeName: 'Test College' }) };
  api.defaults.adapter = async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url}`;
    seen.push({ key, body: config.data && JSON.parse(config.data) });
    const h = handlers[key];
    const out = h ? await h(config) : await fail(404, `unmocked ${key}`);
    return { ...out, config };
  };
});

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <SettingsProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </SettingsProvider>
      </AuthProvider>
    </MemoryRouter>
  );

describe('Register', () => {
  it('validates the form before calling the API', async () => {
    renderAt('/register');
    await userEvent.click(await screen.findByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/full name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    expect(seen.some((s) => s.key === 'POST /auth/register')).toBe(false);
  });

  it('flags weak passwords and mismatched confirmation', async () => {
    renderAt('/register');
    await userEvent.type(await screen.findByLabelText(/full name/i), 'Asha Rao');
    await userEvent.type(screen.getByLabelText(/email/i), 'asha@t.local');
    await userEvent.type(screen.getByLabelText(/^password/i), 'alllowercase1');
    await userEvent.type(screen.getByLabelText(/confirm/i), 'different');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/upper and lower case/i)).toBeInTheDocument();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('creates the account and signs in', async () => {
    handlers['POST /auth/register'] = () =>
      ok({ user: { _id: 'u1', name: 'Asha Rao', email: 'asha@t.local', role: 'student' }, profile: null, accessToken: 'tok' });
    handlers['GET /dashboard'] = () => ok({});
    renderAt('/register');
    await userEvent.type(await screen.findByLabelText(/full name/i), 'Asha Rao');
    await userEvent.type(screen.getByLabelText(/email/i), 'asha@t.local');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Strong@12345');
    await userEvent.type(screen.getByLabelText(/confirm/i), 'Strong@12345');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(tokenStore.access).toBe('tok'));
    expect(seen.find((s) => s.key === 'POST /auth/register').body).toEqual({
      name: 'Asha Rao',
      email: 'asha@t.local',
      password: 'Strong@12345',
    });
  });
});

describe('Forgot password', () => {
  it('rejects a malformed email locally', async () => {
    renderAt('/forgot-password');
    await userEvent.type(await screen.findByLabelText(/email/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /link|send|reset/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
  });

  it('shows the generic confirmation and, in development, the reset link', async () => {
    handlers['POST /auth/forgot-password'] = () =>
      ok(
        { resetLink: 'http://localhost:5173/reset-password?token=abc' },
        'If an account exists for that email, a reset link has been generated.'
      );
    renderAt('/forgot-password');
    await userEvent.type(await screen.findByLabelText(/email/i), 'asha@t.local');
    await userEvent.click(screen.getByRole('button', { name: /link|send|reset/i }));
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
    expect(screen.getByText(/reset-password\?token=abc/)).toBeInTheDocument();
  });
});

describe('session restore', () => {
  it('restores a signed-in user through the refresh cookie on page load', async () => {
    localStorage.setItem('sms.session', '1');
    handlers['POST /auth/refresh'] = () => ok({ accessToken: 'fresh-token' });
    handlers['GET /auth/me'] = () => ok({ user: { _id: 'u1', name: 'Asha Rao', email: 'a@t.local', role: 'student' }, profile: null });
    handlers['GET /settings'] = () => ok({ collegeName: 'Test College' });
    handlers['GET /dashboard'] = () => ok({});
    renderAt('/notices');
    await waitFor(() => expect(tokenStore.access).toBe('fresh-token'));
    expect(await screen.findByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
    expect(seen.map((s) => s.key).slice(0, 3)).toContain('POST /auth/refresh');
  });

  it('falls back to the login page when the cookie is no longer valid', async () => {
    localStorage.setItem('sms.session', '1');
    handlers['POST /auth/refresh'] = () => fail(401, 'Session expired');
    renderAt('/notices');
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(tokenStore.hasSession).toBe(false);
  });
});

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => {
      throw new Error('kaboom');
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/ran into a problem/i);
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});

describe('FileLink', () => {
  it('renders a dash when there is no file', () => {
    render(<FileLink file={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows name and size', () => {
    render(<FileLink file={{ path: 'materials/a.pdf', originalName: 'notes.pdf', size: 2048 }} />);
    expect(screen.getByRole('link', { name: /notes\.pdf/ })).toHaveTextContent('2 KB');
  });
});
