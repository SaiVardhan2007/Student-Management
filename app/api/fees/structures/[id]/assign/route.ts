import { route } from '@/lib/api';
import * as f from '@/services/fee.service';

export const POST = route({ roles: ['admin'] }, f.assignStructure);
