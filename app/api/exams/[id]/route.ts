import { itemRoutes } from '@/lib/crud-routes';
import { exams } from '@/services/schedule.service';
import { examSchema } from '@/validators/ops';

const routes = itemRoutes(exams, { schema: examSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
