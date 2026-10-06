import { route } from '@/lib/api';
import * as l from '@/services/library.service';
import { bookSchema } from '@/validators/services';

export const GET = route({}, l.listBooks);
export const POST = route({ roles: ['admin'], body: bookSchema }, l.createBook);
