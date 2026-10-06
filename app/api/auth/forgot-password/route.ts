import { route } from '@/lib/api';
import { forgotPasswordSchema } from '@/validators/auth';
import { forgotPassword } from '@/services/auth.service';

export const POST = route({ public: true, authLimiter: true, body: forgotPasswordSchema }, forgotPassword);
