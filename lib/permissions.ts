// Which roles may open which pages. Used by proxy.ts (page gate) and the sidebar.
import type { Role } from './context';

export const ROLES: Role[] = ['admin', 'faculty', 'student', 'parent'];
export const STAFF: Role[] = ['admin', 'faculty'];
export const ALL: Role[] = ['admin', 'faculty', 'student', 'parent'];

/**
 * Which roles may open which page. Longest matching prefix wins; paths not listed are open to every
 * signed-in user. (The API enforces the same rules independently — hiding links is never the only defence.)
 */
const PAGE_ROLES: [string, Role[]][] = [
  ['/students', ['admin', 'faculty', 'student', 'parent']], // detail pages are scoped again by the API
  ['/marks', ['admin', 'faculty']],
  ['/reports', ['admin', 'faculty']],
  ['/assignments', ['admin', 'faculty', 'student']],
  ['/materials', ['admin', 'faculty', 'student']],
  ['/results', ['student', 'parent']],
  ['/my-children', ['parent']],
  ['/documents', ['admin', 'student', 'parent']],
  ['/fees', ['admin', 'student', 'parent']],
  ['/library', ['admin', 'student', 'parent']],
  ['/placements', ['admin', 'student']],
  ['/faculty', ['admin']],
  ['/users', ['admin']],
  ['/academic-setup', ['admin']],
  ['/import', ['admin']],
  ['/audit-logs', ['admin']],
  ['/settings', ['admin']],
];

const EXACT_ROLES: Record<string, Role[]> = {
  '/students': ['admin', 'faculty'], // the list; /students/[id] is open to all roles (API-scoped)
};

export function allowedRolesFor(pathname: string): Role[] | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (EXACT_ROLES[p]) return EXACT_ROLES[p];
  let best: [string, Role[]] | null = null;
  for (const entry of PAGE_ROLES) {
    if ((p === entry[0] || p.startsWith(entry[0] + '/')) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

export const canAccessPath = (role: Role | undefined, pathname: string) => {
  const allowed = allowedRolesFor(pathname);
  return !allowed || (!!role && allowed.includes(role));
};

/** Public pages (no session needed). */
export const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];
export const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
