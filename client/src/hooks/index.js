import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client.js';

export function useDebounce(value, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Fetch one endpoint. Returns { data, meta, loading, error, reload }. */
export function useFetch(url, params, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, meta: null, loading: enabled, error: null });
  const key = JSON.stringify([url, params]);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !url) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.get(url, { params });
      if (id === seq.current) setState({ data: res.data.data, meta: res.data.meta || null, loading: false, error: null });
    } catch (err) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err, 'Unable to load data.') }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Server-side paginated list state (page, search, sort, filters). */
export function useListQuery(url, { limit = 15, initialFilters = {}, initialSort } = {}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [filters, setFilters] = useState(initialFilters);
  const debounced = useDebounce(search);

  const params = { page, limit, sort, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null)) };
  if (debounced) params.search = debounced;
  const q = useFetch(url, params);

  // go back to page 1 whenever the query changes
  useEffect(() => { setPage(1); }, [debounced, sort, filters]);

  return {
    ...q,
    items: q.data || [],
    page, setPage, search, setSearch, sort, setSort, filters,
    setFilter: (k, v) => setFilters((f) => ({ ...f, [k]: v })),
    resetFilters: () => { setFilters(initialFilters); setSearch(''); },
    hasQuery: !!debounced || Object.values(filters).some((v) => v !== '' && v != null),
  };
}

export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  return [on, useCallback(() => setOn((v) => !v), []), setOn];
}

/** Close a popup on outside click / Escape. */
export function useDismiss(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [ref, onClose, active]);
}
