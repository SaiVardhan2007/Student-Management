import { route } from '@/lib/api';
import * as r from '@/services/report.service';

export const GET = route({ roles: ['admin', 'faculty'] }, r.generate);
