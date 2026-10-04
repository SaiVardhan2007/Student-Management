import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * Reject Mongo operator injection: any key starting with "$" or containing "." in the body, query or params
 * is refused with a 400 instead of being silently dropped, so clients learn about the mistake.
 */
export function findUnsafeKey(value, trail = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findUnsafeKey(value[i], `${trail}[${i}]`);
      if (bad) return bad;
    }
  } else if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.')) return trail ? `${trail}.${k}` : k;
      const bad = findUnsafeKey(v, trail ? `${trail}.${k}` : k);
      if (bad) return bad;
    }
  }
  return null;
}

export function sanitizeInput(req, _res, next) {
  for (const part of ['body', 'query', 'params']) {
    const bad = findUnsafeKey(req[part]);
    if (bad) return next(AppError.badRequest(`Invalid field name in request ${part}: "${bad}"`));
  }
  next();
}

const limiterOpts = { standardHeaders: true, legacyHeaders: false };

export const apiLimiter = rateLimit({
  ...limiterOpts,
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 100000 : env.apiRateLimit,
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.' },
});

export const authLimiter = rateLimit({
  ...limiterOpts,
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 100000 : env.authRateLimit,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});
