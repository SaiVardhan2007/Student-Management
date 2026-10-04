import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { startJobs } from './jobs/index.js';

async function main() {
  await connectDB();
  const app = createApp();
  const server = app.listen(env.port, () => logger.info(`API listening on http://localhost:${env.port} (${env.nodeEnv})`));
  startJobs();

  // graceful shutdown: stop accepting connections, finish in-flight requests, then close the database
  let closing = false;
  const shutdown = (sig) => {
    if (closing) return;
    closing = true;
    logger.info(`${sig} received, shutting down`);
    setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      try {
        await disconnectDB();
      } finally {
        process.exit(0);
      }
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err));

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
