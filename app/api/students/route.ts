import { route } from '@/lib/api';
import * as students from '@/services/student.service';
import { createStudentSchema } from '@/validators/people';

export const GET = route({ roles: ['admin', 'faculty', 'parent'] }, students.list);
export const POST = route({ roles: ['admin'], body: createStudentSchema }, students.create);
