// Simple in-memory rate limiter used by route() to slow down abusive clients.
/** Minimal in-memory fixed-window limiter (single local process, same constraint as express-rate-limit before). */
type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = g.__rl || (g.__rl = new Map());
const WINDOW_MS = 15 * 60 * 1000;

/** Counts one request for `key`. Returns whether the limit is exceeded and how many seconds until the window resets. */
export function rateLimit(key: string, limit: number): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  // clean out expired buckets now and then so the map cannot grow forever
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  b.count += 1;
  return { limited: b.count > limit, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
}

export const resetRateLimits = () => buckets.clear();
