'use client';

// Small reusable React hooks: debounced values, data fetching, paginated lists, toggles and click-outside.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, setWriteHandler } from '@/lib/api-client';

/** Returns `value` only after it has stopped changing for `delay` ms (used so search boxes don't call the API on every keystroke). */
export function useDebounce<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/**
 * Response cache (stale-while-revalidate): a page visited before shows its last data instantly while a fresh copy
 * loads in the background. It is kept in sessionStorage too, so it survives reloads for as long as the tab is open.
 * Cleared on every write (POST/PUT/PATCH/DELETE, incl. login/logout) and whenever the signed-in user changes, so it
 * never serves data across users or after a change.
 */
const STORE_KEY = 'sms.cache';
const responseCache = new Map<string, { data: any; meta: any }>();
const MAX_CACHE = 150;
// GETs in progress, shared so components asking for the same data at once make a single request
const inflight = new Map<string, Promise<{ data: any; meta: any }>>();
// bumped by every clear, so a response that was requested before a write is not cached after it
let generation = 0;
// id of the user the cached data belongs to
let owner: string | null = null;
// false until the first client render: until then the page must match the server HTML, which had no cache
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

if (typeof window !== 'undefined') {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (stored) {
      owner = stored.owner;
      for (const [k, v] of stored.entries) responseCache.set(k, v);
    }
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
}

function persist() {
  if (typeof window === 'undefined' || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ owner, entries: [...responseCache] }));
    } catch {
      // over the storage quota (or unavailable): keep the in-memory cache only
      try {
        sessionStorage.removeItem(STORE_KEY);
      } catch {
        /* storage unavailable */
      }
    }
  }, 300);
}

export function clearFetchCache() {
  generation++;
  responseCache.clear();
  inflight.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* storage unavailable */
  }
}

// First path segment of an API URL ('/attendance/roster?x' -> 'attendance').
const areaOf = (url: string) => url.replace(/^\/+/, '').split(/[/?]/)[0];
// Data that summarises other areas, dropped after every write.
const ALWAYS_STALE = ['dashboard', 'reports', 'notifications'];

/**
 * After a write to `url`: drop the cached data of the same area (and the summaries above) so those pages load fresh.
 * Other pages keep their copy, which they still show instantly and refresh in the background. Sign-in/out (and any
 * write without a URL) drops everything.
 */
function invalidate(url?: string) {
  const area = url && areaOf(url);
  if (!area || area === 'auth') return clearFetchCache();
  generation++;
  inflight.clear();
  const stale = new Set([area, ...ALWAYS_STALE]);
  for (const key of [...responseCache.keys()]) {
    if (stale.has(areaOf(JSON.parse(key)[0] || ''))) responseCache.delete(key);
  }
  persist();
}
setWriteHandler(invalidate);

/** Ties the cache to the signed-in user: data cached for anyone else (or for nobody) is dropped. */
export function setCacheOwner(userId: string | null) {
  if (owner === userId) return;
  clearFetchCache();
  owner = userId;
}

function remember(key: string, value: { data: any; meta: any }) {
  responseCache.delete(key);
  responseCache.set(key, value);
  if (responseCache.size > MAX_CACHE) responseCache.delete(responseCache.keys().next().value!);
  persist();
}

/** GET through the cache: joins a request already in flight for the same key instead of starting another. */
function fetchShared(key: string, url: string, params?: Record<string, any>) {
  let pending = inflight.get(key);
  if (!pending) {
    const gen = generation;
    pending = api
      .get(url, { params })
      .then((res) => {
        const value = { data: res.data.data, meta: res.data.meta || null };
        if (gen === generation) remember(key, value);
        return value;
      })
      .finally(() => {
        if (inflight.get(key) === pending) inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return pending;
}

/** Fetch one endpoint. Returns { data, meta, loading, error, reload }. */
export function useFetch(url: string | null | undefined, params?: Record<string, any>, { enabled = true }: { enabled?: boolean } = {}) {
  const key = JSON.stringify([url, params]);
  const [state, setState] = useState<{ data: any; meta: any; loading: boolean; error: string | null }>(() => {
    const hit = hydrated && enabled && url ? responseCache.get(key) : undefined;
    return hit ? { ...hit, loading: false, error: null } : { data: null, meta: null, loading: enabled, error: null };
  });
  const seq = useRef(0);

  const load = useCallback(
    async (background = false) => {
      if (!enabled || !url) return;
      const id = ++seq.current;
      const hit = responseCache.get(key);
      if (hit && background) setState({ ...hit, loading: false, error: null });
      else setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // a manual reload always asks the server again
        if (!background) inflight.delete(key);
        const value = await fetchShared(key, url, params);
        if (id === seq.current) setState({ ...value, loading: false, error: null });
      } catch (err) {
        if (id === seq.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err, 'Unable to load data.') }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, enabled]
  );

  useEffect(() => {
    hydrated = true;
    load(true);
  }, [load]);
  const reload = useCallback(() => load(false), [load]);
  return { ...state, reload };
}

/** Server-side paginated list state (page, search, sort, filters). */
export function useListQuery(
  url: string,
  { limit = 15, initialFilters = {}, initialSort }: { limit?: number; initialFilters?: Record<string, any>; initialSort?: string } = {}
) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string | undefined>(initialSort);
  const [filters, setFilters] = useState<Record<string, any>>(initialFilters);
  const debounced = useDebounce(search);

  // The page belongs to the query it was chosen for: when search/sort/filters change, we are back on page 1
  // (derived here instead of reset in an effect, so there is no extra render with a stale page).
  const queryKey = JSON.stringify([debounced, sort, filters]);
  const [pageState, setPageState] = useState({ key: queryKey, page: 1 });
  const page = pageState.key === queryKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: queryKey, page: p });

  const params: Record<string, any> = { page, limit, sort };
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value != null) params[name] = value;
  }
  if (debounced) params.search = debounced;
  const q = useFetch(url, params);
  // the search and filters without paging: used to export "what the table shows"
  const { page: _page, limit: _limit, sort: _sort, ...queryParams } = params;

  return {
    ...q,
    items: q.data || [],
    page,
    setPage,
    queryParams,
    search,
    setSearch,
    sort,
    setSort,
    filters,
    setFilter: (k, v) => setFilters((f) => ({ ...f, [k]: v })),
    resetFilters: () => {
      setFilters(initialFilters);
      setSearch('');
    },
    hasQuery: !!debounced || Object.values(filters).some((v) => v !== '' && v != null),
  };
}

/** A true/false state with a flip function: returns [on, toggle, setOn]. */
export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  return [on, useCallback(() => setOn((v) => !v), []), setOn];
}

/** Close a popup on outside click / Escape. */
export function useDismiss(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onClose, active]);
}
