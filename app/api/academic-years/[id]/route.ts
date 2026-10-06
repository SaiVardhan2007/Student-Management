import { itemRoutes } from '@/lib/crud-routes';
import { academicYears } from '@/services/academic.service';
import { academicYearSchema } from '@/validators/academic';

const routes = itemRoutes(academicYears, { schema: academicYearSchema });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
