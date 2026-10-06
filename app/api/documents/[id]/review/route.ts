import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { documentReviewSchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin'], body: documentReviewSchema }, s.reviewDocument);
