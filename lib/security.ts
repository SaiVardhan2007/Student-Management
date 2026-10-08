// Request-safety check against MongoDB operator injection.
/**
 * Reject Mongo operator injection: any key containing "$" or "." in the body, query or params
 * is refused with a 400 instead of being silently dropped, so clients learn about the mistake.
 * (Keys such as `filter[$where]` are caught too, since query strings are flat here.)
 */
export function findUnsafeKey(value: unknown, trail = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findUnsafeKey(value[i], `${trail}[${i}]`);
      if (bad) return bad;
    }
  } else if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k.includes('$') || k.includes('.')) return trail ? `${trail}.${k}` : k;
      const bad = findUnsafeKey(v, trail ? `${trail}.${k}` : k);
      if (bad) return bad;
    }
  }
  return null;
}
