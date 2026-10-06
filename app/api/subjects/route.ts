import { collectionRoutes } from '@/lib/crud-routes';
import { subjects } from '@/services/academic.service';
import { subjectSchema } from '@/validators/academic';

const routes = collectionRoutes(subjects, { schema: subjectSchema });
export const GET = routes.GET;
export const POST = routes.POST;
