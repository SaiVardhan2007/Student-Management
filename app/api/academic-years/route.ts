import { collectionRoutes } from '@/lib/crud-routes';
import { academicYears } from '@/services/academic.service';
import { academicYearSchema } from '@/validators/academic';

const routes = collectionRoutes(academicYears, { schema: academicYearSchema });
export const GET = routes.GET;
export const POST = routes.POST;
