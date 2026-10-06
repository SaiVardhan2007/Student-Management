import { itemRoutes } from '@/lib/crud-routes';
import { semesters } from '@/services/academic.service';
import { semesterSchema } from '@/validators/academic';

const routes = itemRoutes(semesters, { schema: semesterSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
