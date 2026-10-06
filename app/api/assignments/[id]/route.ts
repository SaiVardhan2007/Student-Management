import { route } from '@/lib/api';
import * as assignments from '@/services/assignment.service';
import { assignmentUpdateSchema } from '@/validators/ops';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, assignments.get);
export const PATCH = route({ roles: ['admin', 'faculty'], upload: uploadSingle('assignments', 'attachment'), body: assignmentUpdateSchema }, assignments.update);
export const DELETE = route({ roles: ['admin', 'faculty'] }, assignments.remove);
