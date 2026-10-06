import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User, Student } from '@/models';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { ok, ApiResult } from '@/lib/response';
import type { Ctx } from '@/lib/context';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  sha256,
  readCookie,
  REFRESH_COOKIE,
  setAuthCookies,
  clearAuthCookies,
  wantsCookieTransport,
  profileOf,
} from '@/lib/auth';
import { audit } from '@/services/audit';

// compared against when the account does not exist, so response time does not reveal valid emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const MAX_SESSIONS = 5;

async function issueTokens(user: any) {
  const accessToken = await signAccessToken(user);
  const refreshToken = await signRefreshToken(user);
  const expiresAt = new Date(Date.now() + env.jwtRefreshExpiresDays * 86400000);
  // keep only valid tokens, cap the number of concurrent sessions
  const fresh = await User.findById(user._id).select('+refreshTokens');
  const tokens = (fresh.refreshTokens || []).filter((t: any) => t.expiresAt > new Date()).slice(-(MAX_SESSIONS - 1));
  tokens.push({ tokenHash: sha256(refreshToken), expiresAt });
  fresh.refreshTokens = tokens;
  await fresh.save();
  return { accessToken, refreshToken };
}

/**
 * Send tokens: browser clients get httpOnly cookies (nothing secret reaches JavaScript);
 * other API clients keep receiving the tokens in the JSON body.
 */
function sendTokens(ctx: Ctx, tokens: { accessToken: string; refreshToken: string }, extra: object, message: string, status = 200) {
  if (wantsCookieTransport(ctx.request)) return setAuthCookies(ok(extra, message, status), tokens);
  return ok({ ...extra, ...tokens }, message, status);
}

export async function login(ctx: Ctx) {
  const { email, password } = ctx.body;
  const user = await User.findOne({ email }).select('+password +failedLogins +lockUntil');
  if (user?.lockUntil && user.lockUntil > new Date()) {
    await bcrypt.compare(password, DUMMY_HASH);
    const mins = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw new AppError(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429);
  }
  const valid = user ? await user.comparePassword(password) : (await bcrypt.compare(password, DUMMY_HASH), false);
  if (!valid) {
    if (user) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= env.lockoutMaxAttempts) {
        user.lockUntil = new Date(Date.now() + env.lockoutMinutes * 60000);
        user.failedLogins = 0;
      }
      await user.save({ validateModifiedOnly: true });
    }
    await audit({ ip: ctx.ip, user: user || undefined }, 'LOGIN_FAILED', 'User', user?._id, { email });
    throw AppError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw AppError.forbidden('Your account has been deactivated. Contact the administrator.');

  user.lastLoginAt = new Date();
  user.failedLogins = 0;
  user.lockUntil = undefined;
  await user.save({ validateModifiedOnly: true });
  const tokens = await issueTokens(user);
  ctx.user = user;
  await audit(ctx, 'LOGIN', 'User', user._id);
  return sendTokens(ctx, tokens, { user, profile: await profileOf(user) }, 'Logged in');
}

// Self sign-up: always creates a student-role account (never admin/faculty). If an admin already added a
// student record with the same email, the new account is linked to it automatically.
export async function register(ctx: Ctx) {
  const { name, email, password } = ctx.body;
  if (await User.exists({ email })) throw AppError.conflict('An account with this email already exists. Please sign in.');

  const user = await User.create({ name, email, password, role: 'student' });
  await Student.updateOne({ email, user: { $exists: false } }, { user: user._id });
  ctx.user = user;
  await audit(ctx, 'REGISTER', 'User', user._id);
  const tokens = await issueTokens(user);
  return sendTokens(ctx, tokens, { user, profile: await profileOf(user) }, 'Account created', 201);
}

export async function refresh(ctx: Ctx) {
  const refreshToken = ctx.body?.refreshToken || readCookie(ctx.request, REFRESH_COOKIE);
  if (!refreshToken) throw AppError.unauthorized('Session expired. Please log in again.');
  const payload = await verifyRefreshToken(refreshToken);
  if (payload.type !== 'refresh') throw AppError.unauthorized('Invalid token');
  const user = await User.findById(payload.sub).select('+refreshTokens');
  const hash = sha256(refreshToken);
  const stored = user?.refreshTokens?.find((t: any) => t.tokenHash === hash && t.expiresAt > new Date());
  if (!user || !stored) throw AppError.unauthorized('Session expired. Please log in again.');
  if (!user.isActive) throw AppError.forbidden('Your account has been deactivated.');

  // rotate: drop the used token
  user.refreshTokens = user.refreshTokens.filter((t: any) => t.tokenHash !== hash);
  await user.save();
  return sendTokens(ctx, await issueTokens(user), {}, 'Token refreshed');
}

/**
 * Sign out. Deliberately tolerant: it also works when the access token has already expired, so the browser's
 * httpOnly cookies can always be cleared and the refresh token revoked.
 */
export async function logout(ctx: Ctx) {
  const refreshToken = ctx.body?.refreshToken || readCookie(ctx.request, REFRESH_COOKIE);
  if (refreshToken) {
    try {
      const payload = await verifyRefreshToken(refreshToken);
      const user = await User.findById(payload.sub).select('+refreshTokens');
      if (user) {
        user.refreshTokens = user.refreshTokens.filter((t: any) => t.tokenHash !== sha256(refreshToken));
        await user.save();
        await audit({ ip: ctx.ip, user }, 'LOGOUT', 'User', user._id);
      }
    } catch {
      /* already invalid — nothing to revoke */
    }
  }
  return clearAuthCookies(ok(null, 'Logged out'));
}

export async function me(ctx: Ctx) {
  return ok({ user: ctx.user, profile: await profileOf(ctx.user) });
}

export async function changePassword(ctx: Ctx) {
  const { currentPassword, newPassword } = ctx.body;
  const user = await User.findById(ctx.user._id).select('+password +refreshTokens');
  if (!(await user.comparePassword(currentPassword))) throw AppError.badRequest('Current password is incorrect');
  if (currentPassword === newPassword) throw AppError.badRequest('New password must differ from the current password');
  user.password = newPassword;
  user.mustChangePassword = false;
  user.refreshTokens = []; // sign out other sessions
  await user.save();
  ctx.user = user;
  await audit(ctx, 'PASSWORD_CHANGED', 'User', user._id);
  return sendTokens(ctx, await issueTokens(user), {}, 'Password changed');
}

export async function forgotPassword(ctx: Ctx): Promise<ApiResult> {
  const user = await User.findOne({ email: ctx.body.email });
  const generic = 'If an account exists for that email, a reset link has been generated.';
  if (!user || !user.isActive) return ok(null, generic);

  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateModifiedOnly: true });

  const link = `${env.appUrl}/reset-password?token=${token}`;
  // No email service is configured for this local project: the link is printed to the server console.
  logger.info(`[PASSWORD RESET] ${user.email}: ${link}`);
  await audit({ ip: ctx.ip, user }, 'PASSWORD_RESET_REQUESTED', 'User', user._id);
  return ok(env.isProd || env.isTest ? null : { resetLink: link }, generic);
}

export async function resetPassword(ctx: Ctx) {
  const { token, newPassword } = ctx.body;
  const user = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } }).select(
    '+resetTokenHash +resetTokenExpires +refreshTokens'
  );
  if (!user) throw AppError.badRequest('Reset link is invalid or has expired');
  user.password = newPassword;
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.mustChangePassword = false;
  user.refreshTokens = [];
  await user.save();
  await audit({ ip: ctx.ip, user }, 'PASSWORD_RESET', 'User', user._id);
  return ok(null, 'Password has been reset. You can now log in.');
}
