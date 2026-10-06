import { z, type ZodError } from 'zod';

export const formatZodError = (err: ZodError) => err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));

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
export const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
export { z };

/** Returns the first password-policy violation as a message, or null when the password is acceptable. */
export function passwordProblem(value: unknown): string | null {
  const r = password.safeParse(value);
  return r.success ? null : r.error.issues[0].message;
}

/** zod refinements (ZodEffects) have no .partial(); unwrap for PATCH/PUT. */
export const partial = (s: any) => (s._def?.schema ? s._def.schema.partial() : s.partial());
