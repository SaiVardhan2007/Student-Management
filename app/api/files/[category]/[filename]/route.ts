import { route } from '@/lib/api';
import * as f from '@/services/files.service';

export const GET = route({}, f.serve);
