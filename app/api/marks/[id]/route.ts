import { route } from '@/lib/api';
import * as marks from '@/services/marks.service';

export const DELETE = route({ roles: ['admin', 'faculty'] }, marks.remove);
