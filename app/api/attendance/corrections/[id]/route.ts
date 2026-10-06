import { route } from '@/lib/api';
import * as attendance from '@/services/attendance.service';
import { correctionReviewSchema } from '@/validators/attendance';

export const PATCH = route({ roles: ['admin', 'faculty'], body: correctionReviewSchema }, attendance.reviewCorrection);
