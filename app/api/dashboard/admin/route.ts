import { route } from '@/lib/api';
import * as d from '@/services/dashboard.service';

export const GET = route({ roles: ['admin'] }, d.admin);
