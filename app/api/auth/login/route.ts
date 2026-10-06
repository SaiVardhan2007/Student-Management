import { route } from '@/lib/api';
import { loginSchema } from '@/validators/auth';
import { login } from '@/services/auth.service';

export const POST = route({ public: true, authLimiter: true, body: loginSchema }, login);
