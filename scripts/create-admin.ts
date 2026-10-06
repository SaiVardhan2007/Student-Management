/**
 * Create the first administrator (safe for production — creates no demo data).
 *
 *   ADMIN_EMAIL=you@college.edu ADMIN_PASSWORD='Str0ng!Passw0rd' ADMIN_NAME='Registrar' npm run create-admin
 *
 * Idempotent: does nothing if a user with that email already exists.
 */
import './env';
import { connectDB, disconnectDB } from '../lib/mongodb';
import { createAdmin } from '../lib/create-admin';

async function main() {
  await connectDB();
  await createAdmin({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
