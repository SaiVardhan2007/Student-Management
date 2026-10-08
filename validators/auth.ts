// Zod schemas that check request data for login, registration and password changes before the services run.
import { z, email, password } from '@/validators/common';

export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) });
// Students sign up with the admission number the admin entered; faculty sign up and wait for admin approval.
export const registerSchema = z
  .object({
    accountType: z.enum(['student', 'faculty']).default('student'),
    name: z.string().trim().max(120).optional(),
    email,
    password,
    admissionNumber: z.string().trim().max(40).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.accountType === 'student' && !v.admissionNumber)
      ctx.addIssue({ code: 'custom', path: ['admissionNumber'], message: 'Admission number is required' });
    if (v.accountType === 'faculty' && (v.name?.length ?? 0) < 2)
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required' });
  });
export const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const forgotPasswordSchema = z.object({ email, admissionNumber: z.string().trim().max(40).optional() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });
