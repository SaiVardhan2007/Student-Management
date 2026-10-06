import { route } from '@/lib/api';
import * as l from '@/services/library.service';
import { issueBookSchema } from '@/validators/services';

export const POST = route({ roles: ['admin'], body: issueBookSchema }, l.issueBook);
