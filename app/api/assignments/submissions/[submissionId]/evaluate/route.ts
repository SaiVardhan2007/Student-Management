import { route } from '@/lib/api';
import * as assignments from '@/services/assignment.service';
import { evaluateSchema } from '@/validators/ops';

export const PATCH = route({ roles: ['admin', 'faculty'], body: evaluateSchema }, assignments.evaluate);
