import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';

export const DELETE = route({ roles: ['admin', 'student'] }, s.deleteAchievement);
