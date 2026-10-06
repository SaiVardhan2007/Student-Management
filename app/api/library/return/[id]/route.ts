import { route } from '@/lib/api';
import * as l from '@/services/library.service';

export const POST = route({ roles: ['admin'] }, l.returnBook);
