import { route } from '@/lib/api';
import { syncAllEnrollments } from '@/services/academic.service';

export const POST = route({ roles: ['admin'] }, syncAllEnrollments);
