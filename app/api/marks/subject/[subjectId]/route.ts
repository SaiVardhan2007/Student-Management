import { route } from '@/lib/api';
import * as marks from '@/services/marks.service';

export const GET = route({ roles: ['admin', 'faculty'] }, marks.subjectMarks);
