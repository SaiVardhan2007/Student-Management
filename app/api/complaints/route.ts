import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { complaintCreateSchema } from '@/validators/services';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, s.listComplaints);
export const POST = route({ roles: ['student'], upload: uploadSingle('complaints', 'attachment'), body: complaintCreateSchema }, s.createComplaint);
