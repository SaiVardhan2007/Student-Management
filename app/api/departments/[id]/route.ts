import { itemRoutes } from '@/lib/crud-routes';
import { departments } from '@/services/academic.service';
import { departmentSchema } from '@/validators/academic';

const routes = itemRoutes(departments, { schema: departmentSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
