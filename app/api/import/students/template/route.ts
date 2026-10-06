import { route } from '@/lib/api';
import * as i from '@/services/import.service';

export const GET = route({ roles: ['admin'] }, i.template);
