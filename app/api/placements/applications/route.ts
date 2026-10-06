import { route } from '@/lib/api';
import * as p from '@/services/placement.service';

export const GET = route({ roles: ['admin', 'student'] }, p.listApplications);
