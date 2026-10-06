import { itemRoutes } from '@/lib/crud-routes';
import { calendar } from '@/services/calendar.service';
import { calendarSchema } from '@/validators/ops';

const routes = itemRoutes(calendar, { schema: calendarSchema });
export const GET = routes.GET;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
