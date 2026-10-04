import { env } from '../config/env.js';

export const REFRESH_COOKIE = 'sms_refresh';
const COOKIE_PATH = '/api/auth';

/** Minimal Cookie-header parser (avoids a dependency for one cookie). */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const base = () => ({ httpOnly: true, sameSite: 'strict', secure: env.cookieSecure, path: COOKIE_PATH });

export const setRefreshCookie = (res, token) =>
  res.cookie(REFRESH_COOKIE, token, { ...base(), maxAge: env.jwtRefreshExpiresDays * 86400000 });

export const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, base());

/** The SPA opts in to cookie transport; other API clients keep receiving the token in the JSON body. */
export const wantsCookieTransport = (req) => req.get('x-token-transport') === 'cookie';
