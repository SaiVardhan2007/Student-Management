import { route } from '@/lib/api';
import * as users from '@/services/user.service';
import { updateUserSchema } from '@/validators/people';

export const GET = route({ roles: ['admin'] }, users.get);
export const PATCH = route({ roles: ['admin'], body: updateUserSchema }, users.update);
