import { route } from '@/lib/api';
import * as s from '@/services/student-services.service';
import { documentUploadSchema } from '@/validators/services';
import { uploadSingle } from '@/lib/upload';

export const GET = route({ roles: ['admin', 'student', 'parent'] }, s.listDocuments);
export const POST = route({ roles: ['student'], upload: uploadSingle('documents', 'file'), body: documentUploadSchema }, s.uploadDocument);
