import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { SettingsProvider } from '../context/SettingsContext.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { api, tokenStore } from '../api/client.js';

const user = { _id: 'u1', name: 'Asha Rao', email: 'asha@t.local', role: 'student' };

function mockApi(handlers) {
  const adapter = async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url}`;
    const h = handlers[key];
    if (!h) return Promise.reject({ config, response: { status: 404, data: { message: `unmocked ${key}` } } });
    const out = typeof h === 'function' ? h(config) : h;
    if (out.status && out.status >= 400) return Promise.reject({ config, response: { status: out.status, data: out.data } });
    return { data: out, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

const renderApp = (path) =>
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

beforeEach(() => {
  localStorage.clear();
  tokenStore.clear();
});

describe('route guards and sign-in', () => {
  it('sends signed-out visitors to the login page', async () => {
    mockApi({ 'GET /settings/public': { success: true, data: { collegeName: 'Test College' } } });
    renderApp('/students');
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows field errors without calling the API', async () => {
    const login = vi.fn();
    mockApi({ 'POST /auth/login': login, 'GET /settings/public': { success: true, data: { collegeName: 'Test College' } } });
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the server message when credentials are wrong', async () => {
    mockApi({
      'GET /settings/public': { success: true, data: { collegeName: 'Test College' } },
      'POST /auth/login': { status: 401, data: { success: false, message: 'Invalid email or password' } },
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText(/email/i), 'asha@t.local');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Wrong@12345');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('keeps the access token out of web storage after a successful login', async () => {
    mockApi({
      'GET /settings/public': { success: true, data: { collegeName: 'Test College' } },
      'POST /auth/login': { success: true, data: { user, profile: null, accessToken: 'mem-only-token' } },
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText(/email/i), 'asha@t.local');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Right@12345');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(tokenStore.access).toBe('mem-only-token'));
    expect(JSON.stringify({ ...localStorage })).not.toContain('mem-only-token');
  });
});
