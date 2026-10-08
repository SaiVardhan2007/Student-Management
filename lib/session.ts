// Reads the signed-in user on the server (for Server Components).
import 'server-only';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, userFromToken, profileOf } from './auth';

/**
 * The signed-in user for Server Components, or null (no cookie, expired access token, deactivated account…).
 * An expired access token is not an error here: the browser restores the session through the refresh cookie.
 */
export async function getSession() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const user = await userFromToken(token);
    const profile = await profileOf(user);
    // toJSON() strips password hashes, tokens and lockout state
    return { user: JSON.parse(JSON.stringify(user)), profile: JSON.parse(JSON.stringify(profile)) };
  } catch {
    return null;
  }
}
