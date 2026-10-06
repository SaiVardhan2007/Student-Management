import { route } from '@/lib/api';
import * as l from '@/services/library.service';
import { bookSchema } from '@/validators/services';

export const PATCH = route({ roles: ['admin'], body: bookSchema.partial() }, l.updateBook);
export const DELETE = route({ roles: ['admin'] }, l.deleteBook);
