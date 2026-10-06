import { route } from '@/lib/api';
import * as s from '@/services/settings.service';
import { settingsSchema } from '@/validators/services';

export const GET = route({}, s.get);
export const PUT = route({ roles: ['admin'], body: settingsSchema }, s.update);
