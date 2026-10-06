import { route } from '@/lib/api';
import * as faculty from '@/services/faculty.service';
import { z, objectId } from '@/validators/common';

const assignSchema = z.object({ subjects: z.array(objectId), sections: z.array(objectId).optional() });

export const PUT = route({ roles: ['admin'], body: assignSchema }, faculty.assignSubjects);
