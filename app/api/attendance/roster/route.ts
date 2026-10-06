import { route } from '@/lib/api';
import * as attendance from '@/services/attendance.service';

export const GET = route({ roles: ['admin', 'faculty'] }, attendance.roster);
