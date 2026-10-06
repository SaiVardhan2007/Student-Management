import { route } from '@/lib/api';
import * as students from '@/services/student.service';

export const POST = route({ roles: ['admin'] }, students.activate);
