'use client';

/**
 * Browser API client for the app's own Route Handlers.
 *
 * Authentication uses httpOnly cookies set by the server (sms_access / sms_refresh), so no token is ever readable by
 * JavaScript. `sms.session` in localStorage is only a non-secret hint telling the app whether to try restoring a session.
 * On a 401 the client silently calls /api/auth/refresh once (single-flight) and retries the original request.
 */
const SESSION_FLAG = 'sms.session';

const safeStorage = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_FLAG);
    } catch {
      return null;
    }
  },
  set: () => {
    try {
      localStorage.setItem(SESSION_FLAG, '1');
    } catch {
      /* storage unavailable */
    }
  },
  del: () => {
    try {
      localStorage.removeItem(SESSION_FLAG);
    } catch {
      /* storage unavailable */
    }
  },
};

export const sessionHint = {
  get has() {
    return !!safeStorage.get();
  },
  set: () => safeStorage.set(),
  clear: () => safeStorage.del(),
};

export const API_BASE = '/api';

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  headers: Headers;
}

export interface RequestConfig {
  params?: Record<string, any>;
  responseType?: 'json' | 'blob';
  headers?: Record<string, string>;
  timeout?: number;
  _retry?: boolean;
}

/** Error shaped like the previous (axios) client so existing helpers keep working. */
export class ApiError extends Error {
  response?: { status: number; data: any };
  request?: boolean;
  code?: string;
  config?: { url: string };
}

let onSessionExpired: () => void = () => {};
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

function buildUrl(url: string, params?: Record<string, any>) {
  const u = url.startsWith('http') ? url : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  if (!params) return u;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${u}${u.includes('?') ? '&' : '?'}${s}` : u;
}

async function rawRequest(method: string, url: string, data?: unknown, config: RequestConfig = {}): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'X-Token-Transport': 'cookie', ...(config.headers || {}) };
  let body: BodyInit | undefined;
  if (data instanceof FormData) body = data;
  else if (data !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(data);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout ?? 30000);
  let res: Response;
  try {
    res = await fetch(buildUrl(url, config.params), { method, headers, body, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
  } catch (e: any) {
    const err = new ApiError(e?.name === 'AbortError' ? 'timeout' : 'network');
    if (e?.name === 'AbortError') err.code = 'ECONNABORTED';
    else err.request = true;
    err.config = { url };
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let payload: any;
  if (res.ok && config.responseType === 'blob') payload = await res.blob();
  else {
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const err = new ApiError(`Request failed with status ${res.status}`);
    err.response = { status: res.status, data: payload };
    err.config = { url };
    throw err;
  }
  return { data: payload, status: res.status, headers: res.headers };
}

let refreshing: Promise<void> | null = null;

/** Exchange the refresh cookie for a new access cookie. */
export async function refreshSession() {
  // '/auth/*' calls are never retried below, so this cannot loop
  await rawRequest('POST', '/auth/refresh', {});
  sessionHint.set();
}

async function request(method: string, url: string, data?: unknown, config: RequestConfig = {}): Promise<ApiResponse> {
  try {
    return await rawRequest(method, url, data, config);
  } catch (error: any) {
    const isAuthCall = url.startsWith('/auth/');
    if (error.response?.status === 401 && !config._retry && !isAuthCall && sessionHint.has) {
      try {
        refreshing =
          refreshing ||
          refreshSession().finally(() => {
            refreshing = null;
          });
        await refreshing;
        return await request(method, url, data, { ...config, _retry: true });
      } catch (e: any) {
        if (e?.response?.status === 401 || e?.response?.status === 403) {
          sessionHint.clear();
          onSessionExpired();
        }
        throw e?.response ? e : error;
      }
    }
    throw error;
  }
}

export const api = {
  get: (url: string, config?: RequestConfig) => request('GET', url, undefined, config),
  delete: (url: string, config?: RequestConfig) => request('DELETE', url, undefined, config),
  post: (url: string, data?: unknown, config?: RequestConfig) => request('POST', url, data ?? {}, config),
  put: (url: string, data?: unknown, config?: RequestConfig) => request('PUT', url, data ?? {}, config),
  patch: (url: string, data?: unknown, config?: RequestConfig) => request('PATCH', url, data ?? {}, config),
};

/** Turn any thrown error into a human-friendly message. */
export function errorMessage(err: any, fallback = 'Something went wrong. Please try again.') {
  if (err?.response) {
    const d = err.response.data;
    if (d?.message) return d.message as string;
    if (err.response.status === 403) return 'You do not have permission to do that.';
    if (err.response.status === 404) return 'The requested item could not be found.';
    if (err.response.status >= 500) return 'The server ran into a problem. Please try again shortly.';
  } else if (err?.code === 'ECONNABORTED') {
    return 'The request timed out. Check your connection and try again.';
  } else if (err?.request) {
    return 'Cannot reach the server. Check your connection and make sure the application is running.';
  }
  return fallback;
}

/** Field-level errors from the API as { field: message }. */
export function fieldErrors(err: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of err?.response?.data?.errors || []) if (e.field && !out[e.field]) out[e.field] = e.message;
  return out;
}

/** GET a list endpoint and unwrap { data, meta }. */
export async function getList(url: string, params?: Record<string, any>) {
  const res = await api.get(url, { params });
  return { items: res.data.data, meta: res.data.meta };
}

/** Download/open a protected file (fetched with the session cookie, then opened from a blob URL). */
export async function openFile(path: string, { download = false, name }: { download?: boolean; name?: string } = {}) {
  const res = await api.get(`/files/${path}`, { responseType: 'blob', params: download ? { download: 1 } : undefined });
  const url = URL.createObjectURL(res.data);
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name || path.split('/').pop() || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Download a generated file (CSV/PDF report) from an API endpoint. */
export async function downloadFrom(url: string, params: Record<string, any> | undefined, filename: string) {
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
export async function fetchImageUrl(path: string) {
  const res = await api.get(`/files/${path}`, { responseType: 'blob' });
  return URL.createObjectURL(res.data);
}
