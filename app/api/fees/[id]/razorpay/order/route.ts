import { route } from '@/lib/api';
import * as f from '@/services/fee.service';
import { razorpayOrderSchema } from '@/validators/services';

export const POST = route({ roles: ['student'], body: razorpayOrderSchema }, f.razorpayOrder);
