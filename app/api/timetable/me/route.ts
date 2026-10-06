import { route } from '@/lib/api';
import * as s from '@/services/schedule.service';

export const GET = route({ roles: ['student', 'faculty', 'parent'] }, s.myTimetable);
