import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, errorMessage, fieldErrors, tokenStore } from '../api/client.js';

describe('tokenStore', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStore.clear();
  });

  it('keeps the access token in memory only', () => {
    tokenStore.set({ accessToken: 'secret-token' });
    expect(tokenStore.access).toBe('secret-token');
    expect(tokenStore.hasSession).toBe(true);
    const stored = JSON.stringify({ ...localStorage });
    expect(stored).not.toContain('secret-token');
  });

  it('clears the session', () => {
    tokenStore.set({ accessToken: 't' });
    tokenStore.clear();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.hasSession).toBe(false);
  });

  it('survives unavailable web storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(tokenStore.hasSession).toBe(false);
    spy.mockRestore();
  });
});

describe('errorMessage', () => {
  it('prefers the API message', () => {
    expect(errorMessage({ response: { status: 400, data: { message: 'Bad' } } })).toBe('Bad');
  });

  it('has friendly fallbacks by status and failure type', () => {
    expect(errorMessage({ response: { status: 403, data: {} } })).toMatch(/permission/);
    expect(errorMessage({ response: { status: 404, data: {} } })).toMatch(/could not be found/);
    expect(errorMessage({ response: { status: 502, data: {} } })).toMatch(/server ran into a problem/);
    expect(errorMessage({ code: 'ECONNABORTED' })).toMatch(/timed out/);
    expect(errorMessage({ request: {} })).toMatch(/Cannot reach the server/);
    expect(errorMessage(new Error('x'), 'Custom')).toBe('Custom');
  });
});

describe('fieldErrors', () => {
  it('maps the first message per field', () => {
    const err = {
      response: {
        data: {
          errors: [
            { field: 'email', message: 'Bad' },
            { field: 'email', message: 'Dup' },
            { field: 'name', message: 'Req' },
          ],
        },
      },
    };
    expect(fieldErrors(err)).toEqual({ email: 'Bad', name: 'Req' });
    expect(fieldErrors({})).toEqual({});
  });
});

describe('request pipeline', () => {
  afterEach(() => tokenStore.clear());

  it('sends cookies and opts in to cookie transport', () => {
    expect(api.defaults.withCredentials).toBe(true);
    expect(api.defaults.headers['X-Token-Transport']).toBe('cookie');
  });

  it('attaches the bearer token once signed in', async () => {
    tokenStore.set({ accessToken: 'abc' });
    let seen;
    await api
      .get('/ping', {
        adapter: (config) => {
          seen = config.headers.Authorization;
          return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
        },
      })
      .catch(() => {});
    expect(seen).toBe('Bearer abc');
  });
});
