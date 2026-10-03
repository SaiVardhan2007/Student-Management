import { Router } from 'express';
import { validate, email, password, z } from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import * as c from '../controllers/auth.controller.js';

const r = Router();

const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) });
const registerSchema = z.object({ name: z.string().trim().min(2, 'Name is required').max(120), email, password });
const refreshSchema = z.object({ refreshToken: z.string().min(10) });
const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });

r.post('/login', authLimiter, validate(loginSchema), c.login);
r.post('/register', authLimiter, validate(registerSchema), c.register);
r.post('/refresh', authLimiter, validate(refreshSchema), c.refresh);
r.post('/forgot-password', authLimiter, validate(forgotSchema), c.forgotPassword);
r.post('/reset-password', authLimiter, validate(resetSchema), c.resetPassword);

r.use(protect);
r.post('/logout', c.logout);
r.get('/me', c.me);
r.post('/change-password', validate(changeSchema), c.changePassword);

export default r;
