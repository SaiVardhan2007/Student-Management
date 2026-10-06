import { route } from '@/lib/api';
import * as s from '@/services/settings.service';

export const GET = route({ roles: ['admin'] }, s.auditActions);
