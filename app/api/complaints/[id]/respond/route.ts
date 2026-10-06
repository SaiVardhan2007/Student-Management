import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { complaintRespondSchema } from '@/validators/services';

export const POST = route({ body: complaintRespondSchema }, s.respondToComplaint);
