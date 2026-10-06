import { route } from '@/lib/api';
import * as s from '@/services/schedule.service';
import { seatingSchema } from '@/validators/services';

export const POST = route({ roles: ['admin'], body: seatingSchema }, s.generateSeating);
