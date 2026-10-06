import { route } from '@/lib/api';
import * as n from '@/services/notification.service';

export const DELETE = route({}, n.remove);
