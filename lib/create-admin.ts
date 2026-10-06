import { User, Settings } from '@/models';
import { passwordProblem } from '@/validators/common';

/**
 * Create the first administrator (safe for production — creates no demo data). Idempotent: does nothing if a user
 * with that email already exists.
 */
export async function createAdmin({ name, email, password, log = console.log }: { name?: string; email?: string; password?: string; log?: (m: string) => void }) {
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD is too weak: ${problem}`);
  const normalized = String(email).trim().toLowerCase();
  if (await User.exists({ email: normalized })) {
    log(`An account for ${normalized} already exists — nothing to do.`);
    return null;
  }
  const user = await User.create({ name: name || 'Administrator', email: normalized, password, role: 'admin' });
  await Settings.updateOne({ key: 'main' }, { $setOnInsert: { key: 'main', collegeName: 'My College' } }, { upsert: true });
  log(`Administrator created: ${user.email}`);
  return user;
}
