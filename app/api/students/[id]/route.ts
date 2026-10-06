import { route } from '@/lib/api';
import * as students from '@/services/student.service';
import { updateStudentSchema } from '@/validators/people';

const update = route({ roles: ['admin'], body: updateStudentSchema }, students.update);

export const GET = route({ roles: ['admin', 'faculty', 'student', 'parent'] }, students.get);
export const PUT = update;
export const PATCH = update;
export const DELETE = route({ roles: ['admin'] }, students.deactivate);
