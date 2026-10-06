import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { achievementCreateSchema } from '@/validators/services';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, s.listAchievements);
export const POST = route({ roles: ['student'], upload: uploadSingle('achievements', 'certificate'), body: achievementCreateSchema }, s.createAchievement);
