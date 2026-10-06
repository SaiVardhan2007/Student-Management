import { route } from '@/lib/api';
import * as f from '@/services/fee.service';

export const GET = route({}, f.receipt);
