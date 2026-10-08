// Next.js proxy (middleware): runs before every page request and redirects based on the login cookie and role.
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { ACCESS_COOKIE } from '@/lib/cookie-names';
import { canAccessPath, isPublicPath } from '@/lib/permissions';

/**
 * Page-level gate (runs before any page renders):
 *  - anonymous visitors are sent to /login (remembering where they were going)
 *  - signed-in visitors never see /login or /register again
 *  - a valid session without the role for the page is sent to the dashboard
 * The API never trusts this: every Route Handler re-verifies the token against MongoDB and enforces roles itself.
 */
// Same default secret as lib/env.ts. This file cannot import env.ts because it runs in the edge runtime.
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || 'dev-only-access-secret-do-not-use-in-prod');

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ACCESS_COOKIE)?.value;

  let role: string | undefined;
  let expired = false;
  let invalid = !token;
  if (token) {
    try {
      role = ((await jwtVerify(token, secret())).payload as any).role;
    } catch (err: any) {
      // an expired access token can still be renewed through the refresh cookie, so it is not "signed out"
      if (err?.code === 'ERR_JWT_EXPIRED') expired = true;
      else invalid = true;
    }
  }

  if (isPublicPath(pathname)) {
    if (role) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  if (invalid) {
    const url = new URL('/login', request.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + request.nextUrl.search);
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(ACCESS_COOKIE); // forged / corrupted cookie
    return res;
  }

  if (!expired && !canAccessPath(role as any, pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // pages only: API routes authenticate themselves, and static assets must stay public
  matcher: ['/((?!api|_next/static|_next/image|favicon.svg|manifest.webmanifest|robots.txt|.*\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
};
