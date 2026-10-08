// Runs once when the Next.js server starts (Node.js runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startJobs } = await import('./services/jobs');
    // on Vercel the hourly timer cannot run (serverless): /api/cron/jobs does this work instead
    if (!process.env.VERCEL) startJobs();
    // Hosts without a shell (e.g. Render free): create the first admin from ADMIN_EMAIL/ADMIN_PASSWORD at boot (idempotent).
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      try {
        const [{ connectDB }, { createAdmin }] = await Promise.all([import('./lib/mongodb'), import('./lib/create-admin')]);
        await connectDB();
        await createAdmin({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
      } catch (err: any) {
        console.error(`Could not create the first administrator: ${err.message}`);
      }
    }
  }
}
