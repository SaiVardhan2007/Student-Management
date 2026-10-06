import { route } from '@/lib/api';
import { listEnrollments, enrollStudent } from '@/services/academic.service';
import { enrollmentSchema } from '@/validators/academic';

export const GET = route({ roles: ['admin', 'faculty'] }, listEnrollments);
export const POST = route({ roles: ['admin'], body: enrollmentSchema }, enrollStudent);
