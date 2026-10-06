import { z, email, password } from '@/validators/common';

export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) });
export const registerSchema = z.object({ name: z.string().trim().min(2, 'Name is required').max(120), email, password });
export const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });
