import { collectionRoutes } from '@/lib/crud-routes';
import { exams } from '@/services/schedule.service';
import { examSchema } from '@/validators/ops';

const routes = collectionRoutes(exams, { schema: examSchema });
export const GET = routes.GET;
export const POST = routes.POST;
