import { itemRoutes } from '@/lib/crud-routes';
import { timetable } from '@/services/schedule.service';
import { timetableSchema } from '@/validators/ops';

const routes = itemRoutes(timetable, { schema: timetableSchema, read: ['admin', 'faculty'] });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
