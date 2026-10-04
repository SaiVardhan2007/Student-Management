import { z } from 'zod';
import { AppError } from '../utils/AppError.js';

export const formatZodError = (err) => err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));

/** validate(schema[, 'body'|'query'|'params']) — replaces the source with parsed (coerced, stripped) data. */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const errors = formatZodError(result.error);
      return next(AppError.badRequest(`Validation failed: ${errors[0].field} — ${errors[0].message}`, errors));
    }
    req[source] = result.data;
    next();
  };

// ---- shared field validators ----
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const optionalId = objectId
  .optional()
  .or(z.literal('').transform(() => undefined))
  .or(z.null().transform(() => undefined));
export const email = z.string().trim().toLowerCase().email('Invalid email address');
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,14}$/, 'Invalid phone number');
export const optionalPhone = phone.optional().or(z.literal('').transform(() => undefined));
export const dateField = z.coerce.date({ invalid_type_error: 'Invalid date', required_error: 'Date is required' });
export const optionalDate = z
  .union([z.literal(''), z.null(), z.undefined(), z.coerce.date()])
  .transform((v) => (v === '' || v === null ? undefined : v));
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm');
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[0-9]/, 'Password needs a number');
export const str = (max = 200) => z.string().trim().max(max);
export const reqStr = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export { z };

/** Returns the first password-policy violation as a message, or null when the password is acceptable. */
export function passwordProblem(value) {
  const r = password.safeParse(value);
  return r.success ? null : r.error.issues[0].message;
}
