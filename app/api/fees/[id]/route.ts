import { route } from '@/lib/api';
import * as f from '@/services/fee.service';
import { feeUpdateSchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin'], body: feeUpdateSchema }, f.updateFee);
export const DELETE = route({ roles: ['admin'] }, f.removeFee);
