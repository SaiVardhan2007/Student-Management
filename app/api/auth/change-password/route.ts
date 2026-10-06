import { route } from '@/lib/api';
import { changePasswordSchema } from '@/validators/auth';
import { changePassword } from '@/services/auth.service';

export const POST = route({ body: changePasswordSchema }, changePassword);
