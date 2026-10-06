import { route } from '@/lib/api';
import { companies } from '@/services/placement.service';
import { companySchema } from '@/validators/services';

export const GET = route({ roles: ['admin'] }, companies.list);
export const POST = route({ roles: ['admin'], body: companySchema }, companies.create);
