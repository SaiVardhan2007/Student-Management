import { itemRoutes } from '@/lib/crud-routes';
import { subjects } from '@/services/academic.service';
import { subjectSchema } from '@/validators/academic';

const routes = itemRoutes(subjects, { schema: subjectSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
