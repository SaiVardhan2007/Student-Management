import { route } from '@/lib/api';
import * as assignments from '@/services/assignment.service';

export const GET = route({ roles: ['admin', 'faculty'] }, assignments.submissions);
