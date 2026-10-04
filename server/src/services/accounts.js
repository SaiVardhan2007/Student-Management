import crypto from 'crypto';
import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

/** Random temporary password that satisfies the password policy. */
export function generatePassword() {
  const core = crypto
    .randomBytes(9)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, 'x');
  return `${core}Aa1`;
}

/** Create a login account. Returns { user, temporaryPassword? }. */
export async function createAccount({ name, email, role, password }) {
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
