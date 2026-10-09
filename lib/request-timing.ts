// Per-request timing for the Server-Timing header: route() opens a store for each API request and the Mongoose
// plugin in models/register.ts adds the time of every query it runs, so we can see where a slow request spends it.
import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestTiming = { dbMs: number; queries: number };

const g = globalThis as unknown as { __requestTiming?: AsyncLocalStorage<RequestTiming> };
const storage: AsyncLocalStorage<RequestTiming> = g.__requestTiming || (g.__requestTiming = new AsyncLocalStorage());

/** Run `fn` with a fresh timing store; the store is returned with its result so the caller can report it. */
export async function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; timing: RequestTiming }> {
  const timing: RequestTiming = { dbMs: 0, queries: 0 };
  const result = await storage.run(timing, fn);
  return { result, timing };
}

/** Count one database operation that took `ms` (ignored outside an API request, e.g. in scripts). */
export function recordDb(ms: number) {
  const timing = storage.getStore();
  if (!timing) return;
  timing.dbMs += ms;
  timing.queries += 1;
}
