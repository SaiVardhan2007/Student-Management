import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../api/client.js';
import { useDebounce, useDismiss, useFetch, useListQuery, useToggle } from '../hooks/index.js';

const reply = (data, meta) => ({ data: { success: true, data, meta }, status: 200, statusText: 'OK', headers: {} });

let calls;
function mock(handler) {
  calls = [];
  api.defaults.adapter = async (config) => {
    calls.push({ url: config.url, params: config.params });
    const out = await handler(config);
    if (out instanceof Error) return Promise.reject({ config, response: { status: 500, data: { message: out.message } } });
    return { ...out, config };
  };
}

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only publishes the latest value after the delay', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 200), { initialProps: { v: 'a' } });
    rerender({ v: 'ab' });
    rerender({ v: 'abc' });
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(2));
    expect(result.current).toBe('abc');
  });
});

describe('useFetch', () => {
  it('loads data and exposes meta', async () => {
    mock(() => reply([{ id: 1 }], { total: 1 }));
    const { result } = renderHook(() => useFetch('/things', { page: 1 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ id: 1 }]);
    expect(result.current.meta).toEqual({ total: 1 });
    expect(result.current.error).toBeNull();
  });

  it('reports a friendly error and can retry', async () => {
    let fail = true;
    mock(() => (fail ? new Error('Database exploded') : reply(['ok'])));
    const { result } = renderHook(() => useFetch('/things'));
    await waitFor(() => expect(result.current.error).toBe('Database exploded'));
    fail = false;
    await act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual(['ok']));
    expect(result.current.error).toBeNull();
  });

  it('does not call the API when disabled', async () => {
    mock(() => reply([]));
    const { result } = renderHook(() => useFetch('/things', {}, { enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('ignores a stale response when the query changes', async () => {
    const resolvers = {};
    mock(
      (config) =>
        new Promise((resolve) => {
          resolvers[config.params.q] = () => resolve(reply([config.params.q]));
        })
    );
    const { result, rerender } = renderHook(({ q }) => useFetch('/s', { q }), { initialProps: { q: 'first' } });
    rerender({ q: 'second' });
    await waitFor(() => expect(Object.keys(resolvers)).toHaveLength(2));
    await act(async () => {
      resolvers.second();
      resolvers.first(); // arrives last but belongs to an outdated query
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(['second']);
  });
});

describe('useListQuery', () => {
  it('sends paging, search and filters, resetting to page 1 when the query changes', async () => {
    mock(() => reply([{ id: 1 }], { total: 40, pages: 4 }));
    const { result } = renderHook(() => useListQuery('/students', { limit: 10, initialFilters: { status: '' } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls.at(-1).params).toMatchObject({ page: 1, limit: 10 });
    expect(calls.at(-1).params.status).toBeUndefined();
    expect(result.current.hasQuery).toBe(false);

    act(() => result.current.setPage(3));
    await waitFor(() => expect(calls.at(-1).params.page).toBe(3));

    act(() => result.current.setFilter('status', 'active'));
    await waitFor(() => expect(calls.at(-1).params).toMatchObject({ page: 1, status: 'active' }));
    expect(result.current.hasQuery).toBe(true);

    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.hasQuery).toBe(false));
  });

  it('debounces the search box', async () => {
    mock(() => reply([]));
    const { result } = renderHook(() => useListQuery('/students'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSearch('asha'));
    expect(calls.every((c) => c.params.search === undefined)).toBe(true);
    await waitFor(() => expect(calls.at(-1).params.search).toBe('asha'), { timeout: 2000 });
  });
});

describe('useToggle / useDismiss', () => {
  it('toggles and sets explicitly', () => {
    const { result } = renderHook(() => useToggle(false));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    act(() => result.current[2](false));
    expect(result.current[0]).toBe(false);
  });

  it('closes on outside click and Escape, but not on inside click', () => {
    const inside = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(inside, outside);
    const onClose = vi.fn();
    renderHook(() => useDismiss({ current: inside }, onClose, true));
    inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    inside.remove();
    outside.remove();
  });

  it('does nothing while inactive', () => {
    const onClose = vi.fn();
    renderHook(() => useDismiss({ current: document.body }, onClose, false));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
