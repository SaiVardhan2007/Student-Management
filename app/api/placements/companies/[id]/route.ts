import { route } from '@/lib/api';
import { companies } from '@/services/placement.service';
import { companySchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin'], body: companySchema.partial() }, companies.update);
export const DELETE = route({ roles: ['admin'] }, companies.remove);
