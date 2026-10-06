import { itemRoutes } from '@/lib/crud-routes';
import { programs } from '@/services/academic.service';
import { programSchema } from '@/validators/academic';

const routes = itemRoutes(programs, { schema: programSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
