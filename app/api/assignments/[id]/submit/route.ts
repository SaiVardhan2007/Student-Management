import { route } from '@/lib/api';
import * as assignments from '@/services/assignment.service';
import { submitSchema } from '@/validators/ops';
import { uploadMany } from '@/lib/upload';

export const POST = route({ roles: ['student'], upload: uploadMany('submissions', 'files'), body: submitSchema }, assignments.submit);
