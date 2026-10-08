// Types for the `ctx` object that every service function receives from route() in lib/api.ts.
import type { UploadedFile } from './upload';

export type Role = 'admin' | 'faculty' | 'student' | 'parent';

/**
 * Everything a service needs to know about the current request. Built by `route()` in lib/api.ts after the
 * request has been rate-limited, authenticated, authorised, parsed and validated.
 */
export interface Ctx {
  /** the raw Fetch API request */
  request: Request;
  /** authenticated user document (undefined on public routes) */
  user: any;
  /** dynamic route params, e.g. { id } */
  params: Record<string, string>;
  /** URL query string as a plain object (validated/coerced when a query schema is given) */
  query: Record<string, any>;
  /** parsed JSON / urlencoded / multipart fields (validated + coerced when a body schema is given) */
  body: Record<string, any>;
  /** first uploaded file, when the route accepts uploads */
  file?: UploadedFile;
  /** all uploaded files */
  files: UploadedFile[];
  ip: string;
  requestId: string;
  /** per-request caches */
  studentProfile?: any;
  facultyProfile?: any;
  [extra: string]: any;
}
