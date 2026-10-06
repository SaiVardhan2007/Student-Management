import { route } from '@/lib/api';
import * as i from '@/services/import.service';

export const POST = route({ roles: ['admin'] }, i.confirm);
