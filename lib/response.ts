type CookieOpts = { httpOnly?: boolean; sameSite?: 'strict' | 'lax' | 'none'; secure?: boolean; path?: string; maxAge?: number };

/** A JSON API result (status + envelope + cookies). Services return this; `route()` turns it into a Response. */
export class ApiResult {
  cookies: { name: string; value: string; opts: CookieOpts }[] = [];
  constructor(
    public status: number,
    public body: unknown
  ) {}

  setCookie(name: string, value: string, opts: CookieOpts) {
    this.cookies.push({ name, value, opts });
    return this;
  }
  clearCookie(name: string, opts: CookieOpts) {
    this.cookies.push({ name, value: '', opts: { ...opts, maxAge: 0 } });
    return this;
  }
}

export const ok = (data?: unknown, message = 'OK', status = 200, meta?: unknown) => {
  const body: Record<string, unknown> = { success: true, message, data: data === undefined ? null : data };
  if (meta) body.meta = meta;
  return new ApiResult(status, body);
};
export const created = (data?: unknown, message = 'Created') => ok(data, message, 201);
