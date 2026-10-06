import { route } from '@/lib/api';
import * as p from '@/services/placement.service';

export const POST = route({ roles: ['student'] }, p.apply);
