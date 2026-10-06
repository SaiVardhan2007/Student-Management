import { route } from '@/lib/api';
import * as p from '@/services/placement.service';
import { jobSchema } from '@/validators/services';

export const GET = route({ roles: ['admin', 'student'] }, p.listJobs);
export const POST = route({ roles: ['admin'], body: jobSchema }, p.createJob);
