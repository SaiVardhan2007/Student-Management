// Builds the standard list/create/get/update/delete route handlers for a resource from its CRUD service.
import type { ZodTypeAny } from 'zod';
import { route, type Role } from '@/lib/api';
import type { CrudService } from '@/services/crud';
import { partial } from '@/validators/common';

interface Opts {
  /** roles allowed to read (omit = any signed-in user) */
  read?: Role[];
  /** roles allowed to write */
  write?: Role[];
  /** body schema for create; the same schema (made partial) validates updates */
  schema: ZodTypeAny;
}

/** GET (list) + POST (create) handlers for `app/api/<resource>/route.ts`. */
export function collectionRoutes(svc: CrudService, { read, write = ['admin'], schema }: Opts) {
  return {
    GET: route({ roles: read }, svc.list),
    POST: route({ roles: write, body: schema }, svc.create),
  };
}

/** GET / PUT / PATCH / DELETE handlers for `app/api/<resource>/[id]/route.ts`. */
export function itemRoutes(svc: CrudService, { read, write = ['admin'], schema }: Opts) {
  const update = route({ roles: write, body: partial(schema) }, svc.update);
  return {
    GET: route({ roles: read }, svc.get),
    PUT: update,
    PATCH: update,
    DELETE: route({ roles: write }, svc.remove),
  };
}
