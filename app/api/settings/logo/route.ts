import { route } from '@/lib/api';
import * as s from '@/services/settings.service';
import { uploadImage } from '@/lib/upload';

export const POST = route({ roles: ['admin'], upload: uploadImage('photos', 'logo') }, s.uploadLogo);
