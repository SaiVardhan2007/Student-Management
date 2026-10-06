import { route } from '@/lib/api';
import * as m from '@/services/material.service';
import { materialSchema } from '@/validators/ops';
import { uploadSingle } from '@/lib/upload';

export const GET = route({}, m.list);
export const POST = route({ roles: ['admin', 'faculty'], upload: uploadSingle('materials', 'file'), body: materialSchema }, m.create);
