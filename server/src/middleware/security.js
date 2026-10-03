import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/** Strip Mongo operators ($...) and dotted keys from user input to block NoSQL injection. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.')) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

export function sanitizeInput(req, _res, next) {
  if (req.body) req.body = clean(req.body);
  if (req.query) {
    const q = clean(req.query);
    for (const k of Object.keys(req.query)) delete req.query[k];
    Object.assign(req.query, q);
  }
  if (req.params) req.params = clean(req.params);
  next();
}

const limiterOpts = { standardHeaders: true, legacyHeaders: false };

export const apiLimiter = rateLimit({
  ...limiterOpts,
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 100000 : 1000,
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.' },
});

export const authLimiter = rateLimit({
  ...limiterOpts,
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 100000 : 20,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});
