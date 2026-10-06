import { route } from '@/lib/api';
import * as f from '@/services/fee.service';
import { feeStructureSchema } from '@/validators/services';

export const GET = route({ roles: ['admin'] }, f.listStructures);
export const POST = route({ roles: ['admin'], body: feeStructureSchema }, f.createStructure);
