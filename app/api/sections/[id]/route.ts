import { itemRoutes } from '@/lib/crud-routes';
import { sections } from '@/services/academic.service';
import { sectionSchema } from '@/validators/academic';

const routes = itemRoutes(sections, { schema: sectionSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
