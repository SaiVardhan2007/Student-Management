import { route } from '@/lib/api';
import * as n from '@/services/notification.service';

export const PATCH = route({}, n.markRead);
