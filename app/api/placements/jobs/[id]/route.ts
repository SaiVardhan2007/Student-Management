import { route } from '@/lib/api';
import * as p from '@/services/placement.service';
import { jobSchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin'], body: jobSchema.partial() }, p.updateJob);
export const DELETE = route({ roles: ['admin'] }, p.deleteJob);
