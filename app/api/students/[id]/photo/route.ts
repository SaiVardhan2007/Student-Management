import { route } from '@/lib/api';
import * as students from '@/services/student.service';
import { uploadImage } from '@/lib/upload';

export const POST = route({ roles: ['admin'], upload: uploadImage('photos') }, students.uploadPhoto);
