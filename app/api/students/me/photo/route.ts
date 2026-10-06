import { route, type Ctx } from '@/lib/api';
import * as students from '@/services/student.service';
import { uploadImage } from '@/lib/upload';

export const POST = route({ roles: ['student'], upload: uploadImage('photos') }, (ctx: Ctx) => {
  ctx.params.id = 'me';
  return students.uploadPhoto(ctx);
});
