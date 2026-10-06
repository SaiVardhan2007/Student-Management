import { route } from '@/lib/api';
import * as n from '@/services/notice.service';
import { noticeUpdateSchema } from '@/validators/ops';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, n.get);
export const PATCH = route({ roles: ['admin', 'faculty'], upload: uploadSingle('notices', 'attachment'), body: noticeUpdateSchema }, n.update);
export const DELETE = route({ roles: ['admin', 'faculty'] }, n.remove);
