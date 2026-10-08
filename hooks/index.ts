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
 * In-memory response cache (stale-while-revalidate): a page visited before shows its last data instantly while a
 * fresh copy loads in the background. Cleared on every write (POST/PUT/PATCH/DELETE, incl. login/logout), so it
 * never serves data across users or after a change. Lives only in this tab's memory.
 */
const responseCache = new Map<string, { data: any; meta: any }>();
const MAX_CACHE = 150;
export function clearFetchCache() {
  responseCache.clear();
}
setWriteHandler(clearFetchCache);
function remember(key: string, value: { data: any; meta: any }) {
  responseCache.delete(key);
  responseCache.set(key, value);
  if (responseCache.size > MAX_CACHE) responseCache.delete(responseCache.keys().next().value!);
}

/** Fetch one endpoint. Returns { data, meta, loading, error, reload }. */
export function useFetch(url: string | null | undefined, params?: Record<string, any>, { enabled = true }: { enabled?: boolean } = {}) {
  const key = JSON.stringify([url, params]);
  const [state, setState] = useState<{ data: any; meta: any; loading: boolean; error: string | null }>(() => {
    const hit = enabled && url ? responseCache.get(key) : undefined;
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
        const res = await api.get(url, { params });
        const value = { data: res.data.data, meta: res.data.meta || null };
        remember(key, value);
        if (id === seq.current) setState({ ...value, loading: false, error: null });
      } catch (err) {
        if (id === seq.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err, 'Unable to load data.') }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, enabled]
  );

  useEffect(() => {
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
