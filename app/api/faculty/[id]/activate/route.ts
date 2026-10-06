import { route } from '@/lib/api';
import * as faculty from '@/services/faculty.service';

export const POST = route({ roles: ['admin'] }, faculty.activate);
