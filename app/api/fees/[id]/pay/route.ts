import { route } from '@/lib/api';
import * as f from '@/services/fee.service';
import { feePaySchema } from '@/validators/services';

export const POST = route({ roles: ['admin', 'student'], body: feePaySchema }, f.pay);
