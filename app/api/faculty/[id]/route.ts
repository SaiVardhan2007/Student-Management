import { route } from '@/lib/api';
import * as faculty from '@/services/faculty.service';
import { updateFacultySchema } from '@/validators/people';

const update = route({ roles: ['admin'], body: updateFacultySchema }, faculty.update);

export const GET = route({ roles: ['admin', 'faculty'] }, faculty.get);
export const PUT = update;
export const PATCH = update;
export const DELETE = route({ roles: ['admin'] }, faculty.deactivate);
