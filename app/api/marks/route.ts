import { route } from '@/lib/api';
import * as marks from '@/services/marks.service';
import { enterMarksSchema } from '@/validators/attendance';

export const POST = route({ roles: ['admin', 'faculty'], body: enterMarksSchema }, marks.enter);
