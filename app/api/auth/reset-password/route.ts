import { route } from '@/lib/api';
import { resetPasswordSchema } from '@/validators/auth';
import { resetPassword } from '@/services/auth.service';

export const POST = route({ public: true, authLimiter: true, body: resetPasswordSchema }, resetPassword);
