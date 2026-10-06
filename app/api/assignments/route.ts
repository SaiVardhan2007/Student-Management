import { route } from '@/lib/api';
import * as assignments from '@/services/assignment.service';
import { assignmentSchema } from '@/validators/ops';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, assignments.list);
export const POST = route({ roles: ['admin', 'faculty'], upload: uploadSingle('assignments', 'attachment'), body: assignmentSchema }, assignments.create);
