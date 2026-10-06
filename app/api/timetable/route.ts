import { collectionRoutes } from '@/lib/crud-routes';
import { timetable } from '@/services/schedule.service';
import { timetableSchema } from '@/validators/ops';

const routes = collectionRoutes(timetable, { schema: timetableSchema, read: ['admin', 'faculty'] });
export const GET = routes.GET;
export const POST = routes.POST;
