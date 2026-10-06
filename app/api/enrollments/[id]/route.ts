import { route } from '@/lib/api';
import { dropEnrollment } from '@/services/academic.service';

export const DELETE = route({ roles: ['admin'] }, dropEnrollment);
