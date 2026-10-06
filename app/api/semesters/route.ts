import { collectionRoutes } from '@/lib/crud-routes';
import { semesters } from '@/services/academic.service';
import { semesterSchema } from '@/validators/academic';

const routes = collectionRoutes(semesters, { schema: semesterSchema });
export const GET = routes.GET;
export const POST = routes.POST;
