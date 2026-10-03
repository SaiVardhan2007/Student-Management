import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User, Student, Faculty } from '../models/index.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok } from '../utils/http.js';
import { signAccessToken, signRefreshToken } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { logger } from '../utils/logger.js';

// compared against when the account does not exist, so response time does not reveal valid emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MAX_SESSIONS = 5;

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const expiresAt = new Date(Date.now() + env.jwtRefreshExpiresDays * 86400000);
  // keep only valid tokens, cap the number of concurrent sessions
  const fresh = await User.findById(user._id).select('+refreshTokens');
  const tokens = (fresh.refreshTokens || []).filter((t) => t.expiresAt > new Date()).slice(-(MAX_SESSIONS - 1));
  tokens.push({ tokenHash: sha256(refreshToken), expiresAt });
  fresh.refreshTokens = tokens;
  await fresh.save();
  return { accessToken, refreshToken };
}

async function profileOf(user) {
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

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  const valid = user ? await user.comparePassword(password) : (await bcrypt.compare(password, DUMMY_HASH), false);
  if (!valid) {
    await audit({ ip: req.ip, user: user || undefined }, 'LOGIN_FAILED', 'User', user?._id, { email });
    throw AppError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw AppError.forbidden('Your account has been deactivated. Contact the administrator.');

  user.lastLoginAt = new Date();
  await user.save({ validateModifiedOnly: true });
  const tokens = await issueTokens(user);
  req.user = user;
  await audit(req, 'LOGIN', 'User', user._id);
  ok(res, { user, profile: await profileOf(user), ...tokens }, 'Logged in');
});

// Self sign-up: always creates a student-role account (never admin/faculty). If an admin already added a
// student record with the same email, the new account is linked to it automatically.
export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) throw AppError.conflict('An account with this email already exists. Please sign in.');

  const user = await User.create({ name, email, password, role: 'student' });
  await Student.updateOne({ email, user: { $exists: false } }, { user: user._id });
  req.user = user;
  await audit(req, 'REGISTER', 'User', user._id);
  const tokens = await issueTokens(user);
  res.status(201);
  ok(res, { user, profile: await profileOf(user), ...tokens }, 'Account created');
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwtRefreshSecret);
  } catch {
    throw AppError.unauthorized('Session expired. Please log in again.');
  }
  if (payload.type !== 'refresh') throw AppError.unauthorized('Invalid token');
  const user = await User.findById(payload.sub).select('+refreshTokens');
  const hash = sha256(refreshToken);
  const stored = user?.refreshTokens?.find((t) => t.tokenHash === hash && t.expiresAt > new Date());
  if (!user || !stored) throw AppError.unauthorized('Session expired. Please log in again.');
  if (!user.isActive) throw AppError.forbidden('Your account has been deactivated.');

  // rotate: drop the used token
  user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== hash);
  await user.save();
  ok(res, await issueTokens(user), 'Token refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    const user = await User.findById(req.user._id).select('+refreshTokens');
    user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== sha256(refreshToken));
    await user.save();
  }
  await audit(req, 'LOGOUT', 'User', req.user._id);
  ok(res, null, 'Logged out');
});

export const me = asyncHandler(async (req, res) => {
  ok(res, { user: req.user, profile: await profileOf(req.user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password +refreshTokens');
  if (!(await user.comparePassword(currentPassword))) throw AppError.badRequest('Current password is incorrect');
  if (currentPassword === newPassword) throw AppError.badRequest('New password must differ from the current password');
  user.password = newPassword;
  user.mustChangePassword = false;
  user.refreshTokens = []; // sign out other sessions
  await user.save();
  req.user = user;
  await audit(req, 'PASSWORD_CHANGED', 'User', user._id);
  ok(res, await issueTokens(user), 'Password changed');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  const generic = 'If an account exists for that email, a reset link has been generated.';
  if (!user || !user.isActive) return ok(res, null, generic);

  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateModifiedOnly: true });

  const link = `${env.clientUrl}/reset-password?token=${token}`;
  // No email service is configured for this local project: the link is printed to the server console.
  logger.info(`[PASSWORD RESET] ${user.email}: ${link}`);
  await audit({ ip: req.ip, user }, 'PASSWORD_RESET_REQUESTED', 'User', user._id);
  ok(res, env.isProd || env.isTest ? null : { resetLink: link }, generic);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
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
  await audit({ ip: req.ip, user }, 'PASSWORD_RESET', 'User', user._id);
  ok(res, null, 'Password has been reset. You can now log in.');
});
