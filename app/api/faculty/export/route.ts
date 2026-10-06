import { route } from '@/lib/api';
import * as faculty from '@/services/faculty.service';

export const GET = route({ roles: ['admin'] }, faculty.exportCsv);
