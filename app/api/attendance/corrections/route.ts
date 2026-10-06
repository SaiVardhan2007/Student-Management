import { route } from '@/lib/api';
import * as attendance from '@/services/attendance.service';
import { correctionRequestSchema } from '@/validators/attendance';

export const GET = route({ roles: ['admin', 'faculty', 'student', 'parent'] }, attendance.listCorrections);
export const POST = route({ roles: ['student'], body: correctionRequestSchema }, attendance.requestCorrection);
