import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { complaintUpdateSchema } from '@/validators/services';

export const GET = route({}, s.getComplaint);
export const PATCH = route({ roles: ['admin', 'faculty', 'student'], body: complaintUpdateSchema }, s.updateComplaint);
