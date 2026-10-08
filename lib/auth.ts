// Login tokens (JWT), auth cookies, and loading the signed-in user for each API request.
import crypto from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from './env';
import { AppError } from './errors';
import type { Ctx } from './context';
import { connectDB } from './mongodb';
import { User, Student, Faculty } from '@/models';
import type { ApiResult } from './response';

import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookie-names';
export { ACCESS_COOKIE, REFRESH_COOKIE }; // re-exported so other files can import everything auth-related from here
const REFRESH_PATH = '/api/auth';

const key = (s: string) => new TextEncoder().encode(s);

export const signAccessToken = (user: any) =>
  new SignJWT({ role: user.role, pca: user.passwordChangedAt?.getTime() ?? 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user._id))
    .setIssuedAt()
    .setExpirationTime(env.jwtAccessExpires)
    .sign(key(env.jwtSecret));

export const signRefreshToken = (user: any) =>
  new SignJWT({ type: 'refresh', jti: crypto.randomBytes(12).toString('hex') })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user._id))
    .setIssuedAt()
    .setExpirationTime(`${env.jwtRefreshExpiresDays}d`)
    .sign(key(env.jwtRefreshSecret));

export async function verifyAccessToken(token: string) {
  try {
    return (await jwtVerify(token, key(env.jwtSecret))).payload;
  } catch (err) {
    throw AppError.unauthorized(err instanceof joseErrors.JWTExpired ? 'Session expired' : 'Invalid token');
  }
}

export async function verifyRefreshToken(token: string) {
  try {
    return (await jwtVerify(token, key(env.jwtRefreshSecret))).payload;
  } catch {
    throw AppError.unauthorized('Session expired. Please log in again.');
  }
}

/** Hash used to store reset/refresh tokens in the database instead of the raw value. */
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const cookieBase = (path: string) => ({ httpOnly: true, sameSite: 'strict' as const, secure: env.cookieSecure, path });

/** Browser transport: both tokens travel in httpOnly cookies. API clients (no header) get tokens in the JSON body. */
export const wantsCookieTransport = (request: Request) => request.headers.get('x-token-transport') === 'cookie';

export function setAuthCookies(result: ApiResult, tokens: { accessToken: string; refreshToken: string }) {
  const maxAge = env.jwtRefreshExpiresDays * 86400;
  // the access cookie outlives the (short) JWT so an expired token still reaches the API, which answers 401 -> silent refresh
  result.setCookie(ACCESS_COOKIE, tokens.accessToken, { ...cookieBase('/'), maxAge });
  result.setCookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieBase(REFRESH_PATH), maxAge });
  return result;
}

export function clearAuthCookies(result: ApiResult) {
  result.clearCookie(ACCESS_COOKIE, cookieBase('/'));
  result.clearCookie(REFRESH_COOKIE, cookieBase(REFRESH_PATH));
  return result;
}

/** Reads one cookie value from the raw Cookie header. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
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

/** Loads the (active) user a verified access token belongs to. */
export async function userFromToken(token: string) {
  const payload = await verifyAccessToken(token);
  await connectDB();
  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('Account no longer exists');
  if (!user.isActive) throw AppError.forbidden('Your account has been deactivated. Contact the administrator.');
  // tokens carry the password-change stamp they were issued under; a change invalidates them all
  if (((payload as any).pca ?? 0) !== (user.passwordChangedAt?.getTime() ?? 0)) {
    throw AppError.unauthorized('Password was changed. Please log in again.');
  }
  return user;
}

/** Bearer header first (API clients), then the httpOnly access cookie (browser). */
export async function authenticate(request: Request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : readCookie(request, ACCESS_COOKIE);
  if (!token) throw AppError.unauthorized();
  return userFromToken(token);
}

/** Load the Student profile linked to ctx.user (cached on ctx). */
export async function studentProfile(ctx: Ctx) {
  if (ctx.studentProfile) return ctx.studentProfile;
  const s = await Student.findOne({ user: ctx.user._id });
  if (!s) throw AppError.notFound('No student profile is linked to this account');
  ctx.studentProfile = s;
  return s;
}

export async function facultyProfile(ctx: Ctx) {
  if (ctx.facultyProfile) return ctx.facultyProfile;
  const f = await Faculty.findOne({ user: ctx.user._id });
  if (!f) throw AppError.notFound('No faculty profile is linked to this account');
  ctx.facultyProfile = f;
  return f;
}

/** Linked profile summary returned by login / me. */
export async function profileOf(user: any) {
  if (user.role === 'student') {
    const s = await Student.findOne({ user: user._id }).select('studentId firstName lastName photo department program semester section');
    return s && { type: 'student', id: s._id, studentId: s.studentId };
  }
  if (user.role === 'faculty') {
    const f = await Faculty.findOne({ user: user._id }).select('employeeId department');
    return f && { type: 'faculty', id: f._id, employeeId: f.employeeId };
  }
  return null;
}
