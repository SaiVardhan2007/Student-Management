import { collectionRoutes } from '@/lib/crud-routes';
import { sections } from '@/services/academic.service';
import { sectionSchema } from '@/validators/academic';

const routes = collectionRoutes(sections, { schema: sectionSchema });
export const GET = routes.GET;
export const POST = routes.POST;
