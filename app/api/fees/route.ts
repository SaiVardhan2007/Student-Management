import { route } from '@/lib/api';
import * as f from '@/services/fee.service';
import { feeCreateSchema } from '@/validators/services';

export const GET = route({}, f.list);
export const POST = route({ roles: ['admin'], body: feeCreateSchema }, f.createFee);
