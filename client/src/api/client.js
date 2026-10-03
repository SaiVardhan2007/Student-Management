import axios from 'axios';

const TOKEN_KEY = 'sms.accessToken';
const REFRESH_KEY = 'sms.refreshToken';

export const tokenStore = {
  get access() { return localStorage.getItem(TOKEN_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set({ accessToken, refreshToken }) {
    if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';

export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

api.interceptors.request.use((config) => {
  const t = tokenStore.access;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let refreshing = null;
let onSessionExpired = () => {};
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

async function refreshTokens() {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('no refresh token');
  const res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
  tokenStore.set(res.data.data);
  return res.data.data.accessToken;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall && tokenStore.refresh) {
      original._retry = true;
      try {
        refreshing = refreshing || refreshTokens().finally(() => { refreshing = null; });
        const token = await refreshing;
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        tokenStore.clear();
        onSessionExpired();
      }
    }
    return Promise.reject(error);
  }
);

/** Turn any thrown error into a human-friendly message. */
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.response) {
    const d = err.response.data;
    if (d?.message) return d.message;
    if (err.response.status === 403) return 'You do not have permission to do that.';
    if (err.response.status === 404) return 'The requested item could not be found.';
    if (err.response.status >= 500) return 'The server ran into a problem. Please try again shortly.';
  } else if (err?.code === 'ECONNABORTED') {
    return 'The request timed out. Check your connection and try again.';
  } else if (err?.request) {
    return 'Cannot reach the server. Check your connection and make sure the API is running.';
  }
  return fallback;
}

/** Field-level errors from the API as { field: message }. */
export function fieldErrors(err) {
  const out = {};
  for (const e of err?.response?.data?.errors || []) if (e.field && !out[e.field]) out[e.field] = e.message;
  return out;
}

/** GET a list endpoint and unwrap { data, meta }. */
export async function getList(url, params) {
  const res = await api.get(url, { params });
  return { items: res.data.data, meta: res.data.meta };
}

/** Download/open a protected file (sent with the auth header, then opened from a blob URL). */
export async function openFile(path, { download = false, name } = {}) {
  const res = await api.get(`/files/${path}`, { responseType: 'blob', params: download ? { download: 1 } : undefined });
  const url = URL.createObjectURL(res.data);
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name || path.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Download a generated file (CSV/PDF report) from an API endpoint. */
export async function downloadFrom(url, params, filename) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(res.data);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/** Fetch a protected image as an object URL (for avatars/logos). */
export async function fetchImageUrl(path) {
  const res = await api.get(`/files/${path}`, { responseType: 'blob' });
  return URL.createObjectURL(res.data);
}
