import { collectionRoutes } from '@/lib/crud-routes';
import { calendar } from '@/services/calendar.service';
import { calendarSchema } from '@/validators/ops';

const routes = collectionRoutes(calendar, { schema: calendarSchema });
export const GET = routes.GET;
export const POST = routes.POST;
