import { route } from '@/lib/api';
import { registerSchema } from '@/validators/auth';
import { register } from '@/services/auth.service';

export const POST = route({ public: true, authLimiter: true, body: registerSchema }, register);
