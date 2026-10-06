import { collectionRoutes } from '@/lib/crud-routes';
import { programs } from '@/services/academic.service';
import { programSchema } from '@/validators/academic';

const routes = collectionRoutes(programs, { schema: programSchema });
export const GET = routes.GET;
export const POST = routes.POST;
