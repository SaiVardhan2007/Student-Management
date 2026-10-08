import { route } from '@/lib/api';
import * as users from '@/services/user.service';
import { approveFacultySchema } from '@/validators/people';

export const POST = route({ roles: ['admin'], body: approveFacultySchema }, users.approve);
