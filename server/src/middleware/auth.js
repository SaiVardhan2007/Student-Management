import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { User, Student, Faculty } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';

export const signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, pca: user.passwordChangedAt?.getTime() ?? 0 }, env.jwtSecret, { expiresIn: env.jwtAccessExpires });

export const signRefreshToken = (user) =>
  jwt.sign({ sub: String(user._id), type: 'refresh', jti: crypto.randomBytes(12).toString('hex') }, env.jwtRefreshSecret, {
    expiresIn: `${env.jwtRefreshExpiresDays}d`,
  });

/** Verifies the bearer token and loads the (active) user on every request. */
export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw AppError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    throw AppError.unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('Account no longer exists');
  if (!user.isActive) throw AppError.forbidden('Your account has been deactivated. Contact the administrator.');
  // tokens carry the password-change stamp they were issued under; a change invalidates them all
  if ((payload.pca ?? 0) !== (user.passwordChangedAt?.getTime() ?? 0)) {
    throw AppError.unauthorized('Password was changed. Please log in again.');
  }
  req.user = user;
  next();
});

/** Restrict a route to one or more roles. Must run after `protect`. */
export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };

export const adminOnly = authorize('admin');
export const staff = authorize('admin', 'faculty');

/** Load the Student profile linked to req.user (cached on req). */
export async function studentProfile(req) {
  if (req.studentProfile) return req.studentProfile;
  const s = await Student.findOne({ user: req.user._id });
  if (!s) throw AppError.notFound('No student profile is linked to this account');
  req.studentProfile = s;
  return s;
}

export async function facultyProfile(req) {
  if (req.facultyProfile) return req.facultyProfile;
  const f = await Faculty.findOne({ user: req.user._id });
  if (!f) throw AppError.notFound('No faculty profile is linked to this account');
  req.facultyProfile = f;
  return f;
}
