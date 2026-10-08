// Authentication service: login, register, token refresh, logout, password change and reset.
// Uses JWT access tokens plus refresh tokens stored (hashed) on the user.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User, Student, Faculty } from '@/models';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { sendMail } from '@/lib/mailer';
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

// Create a new access + refresh token pair and save the refresh token (hashed) on the user.
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

/** Check email + password. After too many wrong attempts the account is locked for a while. */
export async function login(ctx: Ctx) {
  const { email, password } = ctx.body;
  const user = await User.findOne({ email }).select('+password +failedLogins +lockUntil');
  if (user?.lockUntil && user.lockUntil > new Date()) {
    await bcrypt.compare(password, DUMMY_HASH);
    const mins = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw new AppError(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429);
  }
  let valid = false;
  if (user) {
    valid = await user.comparePassword(password);
  } else {
    await bcrypt.compare(password, DUMMY_HASH); // same work as a real check, so timing does not reveal unknown emails
  }
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
  if (user.approvalStatus === 'pending') throw AppError.forbidden('Your account is waiting for administrator approval.');
  if (user.approvalStatus === 'rejected') throw AppError.forbidden('Your registration request was not approved. Contact the administrator.');
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

/**
 * Self sign-up.
 * - student: needs the admission number (and email) the admin saved on the student record; each admission number and
 *   each email can be used for one account only. The account is linked to that record and signed in straight away.
 * - faculty: creates a pending, inactive account; an admin reviews it in User accounts and approves or rejects it.
 */
export async function register(ctx: Ctx) {
  const { accountType, name, email, password, admissionNumber } = ctx.body;
  const exists = 'An account with this email already exists. Please sign in.';
  if (await User.exists({ email })) throw AppError.conflict(exists);

  if (accountType === 'faculty') {
    if (await Faculty.exists({ email })) throw AppError.conflict(exists);
    const user = await User.create({ name, email, password, role: 'faculty', isActive: false, approvalStatus: 'pending' });
    await audit({ ip: ctx.ip, user }, 'FACULTY_REGISTRATION_REQUESTED', 'User', user._id);
    const admins = await User.find({ role: 'admin', isActive: true }).select('email');
    if (admins.length)
      await sendMail(
        admins.map((a: any) => a.email),
        'New faculty registration awaiting approval',
        `${name} (${email}) asked for a faculty account.\nReview it under User accounts: ${env.appUrl}/users`
      );
    return ok({ pending: true }, 'Request sent. An administrator will review it and you will be able to sign in once it is approved.', 202);
  }

  const student = await Student.findOne({ studentId: String(admissionNumber).toUpperCase() });
  if (!student) throw AppError.badRequest('Admission number not found. Check it, or ask the administrator to add you.');
  if (student.user) throw AppError.conflict('An account has already been created for this admission number. Please sign in.');
  if (student.email !== email)
    throw AppError.badRequest('This email does not match the one saved for this admission number. Ask the administrator to update it.');

  const user = await User.create({ name: `${student.firstName} ${student.lastName}`, email, password, role: 'student' });
  // claim the record atomically so two requests cannot both link the same admission number
  const claimed = await Student.findOneAndUpdate({ _id: student._id, user: null }, { user: user._id });
  if (!claimed) {
    await User.deleteOne({ _id: user._id });
    throw AppError.conflict('An account has already been created for this admission number. Please sign in.');
  }
  ctx.user = user;
  await audit(ctx, 'REGISTER', 'User', user._id);
  const tokens = await issueTokens(user);
  return sendTokens(ctx, tokens, { user, profile: await profileOf(user) }, 'Account created', 201);
}

/** Swap a valid refresh token for a new token pair (the old refresh token is used up). */
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

/** Change password for the logged-in user and sign out their other sessions. */
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

/**
 * Start a password reset by email. Students must also give their admission number, which has to belong to that email
 * (if the email on file is wrong, the admin fixes it on the student record). The answer is always the same message so
 * nobody can find out which emails or admission numbers exist.
 */
export async function forgotPassword(ctx: Ctx): Promise<ApiResult> {
  const user = await User.findOne({ email: ctx.body.email });
  const generic = 'If the details match an account, a reset link has been sent to the email address.';
  if (!user || !user.isActive) return ok(null, generic);
  if (user.role === 'student') {
    const admission = String(ctx.body.admissionNumber || '').toUpperCase();
    if (!admission || !(await Student.exists({ user: user._id, studentId: admission }))) return ok(null, generic);
  }

  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateModifiedOnly: true });

  // only the hash of the token is stored, the real token goes in the link
  const link = `${env.appUrl}/reset-password?token=${token}`;
  const sent = await sendMail(
    user.email,
    'Reset your password',
    `Hello ${user.name},\n\nUse this link to set a new password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, ignore this email.`
  );
  await audit({ ip: ctx.ip, user }, 'PASSWORD_RESET_REQUESTED', 'User', user._id);
  // with no SMTP server in development the link is also returned so the flow can be tried
  return ok(!sent && !env.isProd && !env.isTest ? { resetLink: link } : null, generic);
}

/** Set a new password using the token from the reset link. */
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
