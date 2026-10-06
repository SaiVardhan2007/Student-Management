import { route } from '@/lib/api';
import * as attendance from '@/services/attendance.service';
import { markAttendanceSchema } from '@/validators/attendance';

export const POST = route({ roles: ['admin', 'faculty'], body: markAttendanceSchema }, attendance.mark);
