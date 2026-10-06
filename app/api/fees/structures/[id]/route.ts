import { route } from '@/lib/api';
import * as f from '@/services/fee.service';

export const DELETE = route({ roles: ['admin'] }, f.deleteStructure);
