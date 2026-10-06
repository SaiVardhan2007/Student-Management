import { collectionRoutes } from '@/lib/crud-routes';
import { departments } from '@/services/academic.service';
import { departmentSchema } from '@/validators/academic';

const routes = collectionRoutes(departments, { schema: departmentSchema });
export const GET = routes.GET;
export const POST = routes.POST;
