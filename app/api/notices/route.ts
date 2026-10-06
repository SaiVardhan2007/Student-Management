import { route } from '@/lib/api';
import * as n from '@/services/notice.service';
import { noticeSchema } from '@/validators/ops';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, n.list);
export const POST = route({ roles: ['admin', 'faculty'], upload: uploadSingle('notices', 'attachment'), body: noticeSchema }, n.create);
