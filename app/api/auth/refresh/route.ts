import { route } from '@/lib/api';
import { refreshSchema } from '@/validators/auth';
import { refresh } from '@/services/auth.service';

export const POST = route({ public: true, authLimiter: true, body: refreshSchema }, refresh);
