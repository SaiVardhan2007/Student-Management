import { route } from '@/lib/api';
import * as students from '@/services/student.service';

export const GET = route({ roles: ['admin'] }, students.exportCsv);
