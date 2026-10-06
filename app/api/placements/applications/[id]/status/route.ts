import { route } from '@/lib/api';
import * as p from '@/services/placement.service';
import { applicationStatusSchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin'], body: applicationStatusSchema }, p.updateApplicationStatus);
