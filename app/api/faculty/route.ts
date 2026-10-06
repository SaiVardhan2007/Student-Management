import { route } from '@/lib/api';
import * as faculty from '@/services/faculty.service';
import { createFacultySchema } from '@/validators/people';

export const GET = route({ roles: ['admin', 'faculty'] }, faculty.list);
export const POST = route({ roles: ['admin'], body: createFacultySchema }, faculty.create);
