import { route } from '@/lib/api';
import * as i from '@/services/import.service';
import { uploadCsv } from '@/lib/upload';

export const POST = route({ roles: ['admin'], upload: uploadCsv }, i.preview);
