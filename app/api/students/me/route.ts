import { route } from '@/lib/api';
import * as students from '@/services/student.service';
import { selfStudentUpdateSchema } from '@/validators/people';

export const GET = route({ roles: ['student'] }, students.getMe);
export const PATCH = route({ roles: ['student'], body: selfStudentUpdateSchema }, students.updateMe);
