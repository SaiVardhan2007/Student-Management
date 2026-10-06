import { route } from '@/lib/api';
import * as users from '@/services/user.service';
import { createUserSchema } from '@/validators/people';

export const GET = route({ roles: ['admin'] }, users.list);
export const POST = route({ roles: ['admin'], body: createUserSchema }, users.create);
