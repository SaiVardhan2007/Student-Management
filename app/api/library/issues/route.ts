import { route } from '@/lib/api';
import * as l from '@/services/library.service';

export const GET = route({ roles: ['admin', 'student', 'parent'] }, l.listIssues);
