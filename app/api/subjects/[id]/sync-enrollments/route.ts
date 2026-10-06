import { route } from '@/lib/api';
import { syncSubjectEnrollments } from '@/services/academic.service';

export const POST = route({ roles: ['admin'] }, syncSubjectEnrollments);
