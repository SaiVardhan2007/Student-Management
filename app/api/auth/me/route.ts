import { route } from '@/lib/api';
import { me } from '@/services/auth.service';

export const GET = route({}, me);
