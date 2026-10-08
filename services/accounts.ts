// Creates login accounts (User documents) for students and faculty.
import crypto from 'crypto';
import { User } from '@/models';
import { AppError } from '@/lib/errors';

/** Random temporary password that satisfies the password policy. */
export function generatePassword() {
  const core = crypto
    .randomBytes(9)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, 'x');
  return `${core}Aa1`;
}

/** Create a login account. If no password is given, a temporary one is generated and the user must change it at first login. Returns { user, temporaryPassword? }. */
export async function createAccount({ name, email, role, password }: { name: string; email: string; role: string; password?: string }) {
  if (await User.exists({ email }))
    throw AppError.conflict('An account with this email already exists', [{ field: 'email', message: 'Already exists' }]);
  const temporaryPassword = password ? undefined : generatePassword();
  const user = await User.create({
    name,
    email,
    role,
    password: password || temporaryPassword,
    mustChangePassword: !password,
  });
  return { user, temporaryPassword };
}
