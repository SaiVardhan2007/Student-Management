import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { achievementVerifySchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin', 'faculty'], body: achievementVerifySchema }, s.verifyAchievement);
