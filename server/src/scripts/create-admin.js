/**
 * Create the first administrator (safe for production — creates no demo data).
 *
 *   ADMIN_EMAIL=you@college.edu ADMIN_PASSWORD='Str0ng!Passw0rd' ADMIN_NAME='Registrar' npm run create-admin
 *
 * Idempotent: does nothing if a user with that email already exists.
 */
import { connectDB, disconnectDB } from '../config/db.js';
import { User, Settings } from '../models/index.js';
import { passwordProblem } from '../middleware/validate.js';

export async function createAdmin({ name, email, password, log = console.log }) {
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  (async () => {
    try {
      await connectDB();
      await createAdmin({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    } finally {
      await disconnectDB().catch(() => {});
    }
  })();
}
