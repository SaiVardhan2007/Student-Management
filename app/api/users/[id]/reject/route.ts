import { route } from '@/lib/api';
import * as users from '@/services/user.service';

export const POST = route({ roles: ['admin'] }, users.reject);
