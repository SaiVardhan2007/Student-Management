/**
 * Development seed data.
 *   npm run seed          adds demo data if the database is empty
 *   npm run seed:reset    wipes ALL collections first
 * Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=true.
 */
import './env';
import { connectDB, disconnectDB } from '../lib/mongodb';
import { seed } from '../lib/seed';

async function main() {
  await connectDB();
  const res = await seed({ reset: process.argv.includes('--reset') });
  if (res) {
    console.log('\nDevelopment credentials (password = SEED_PASSWORD from .env.local, default ChangeMe@123):');
    console.log('  Admin   : admin@college.local');
    console.log('  Faculty : meera.iyer@college.local (also arjun.nair, kavita.sharma, rahul.verma, sana.khan)');
    console.log('  Student : s250001@college.local (S250001 … S250030)');
    console.log('  Parent  : parent@college.local');
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
