import { route } from '@/lib/api';
import * as f from '@/services/fee.service';
import { razorpayVerifySchema } from '@/validators/services';

export const POST = route({ roles: ['student'], body: razorpayVerifySchema }, f.razorpayVerify);
