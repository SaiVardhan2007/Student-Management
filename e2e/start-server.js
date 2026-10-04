// Starts the real API (production mode) against an in-memory MongoDB, seeds demo data and serves client/dist.
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = (p) => pathToFileURL(path.join(here, '..', 'server', p)).href;
const port = Number(process.env.E2E_PORT || 5055);

Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: String(port),
  SERVE_CLIENT: 'true',
  ALLOW_DEMO_SEED: 'true',
  SEED_PASSWORD: 'E2e@Passw0rd1',
  CLIENT_URL: `http://localhost:${port}`,
  JWT_SECRET: 'e2e-access-secret-0123456789abcdef0123456789',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdef012345',
  UPLOAD_DIR: path.join(os.tmpdir(), 'sms-e2e-uploads'),
  AUTH_RATE_LIMIT: '100000',
  API_RATE_LIMIT: '100000',
  LOG_FORMAT: 'json',
});

const { MongoMemoryServer } = await import(
  pathToFileURL(path.join(here, '..', 'server', 'node_modules', 'mongodb-memory-server', 'index.js')).href
);
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('sms_e2e');

const { connectDB, disconnectDB } = await import(server('src/config/db.js'));
const { seed } = await import(server('src/seed.js'));
const { createApp } = await import(server('src/app.js'));

await connectDB();
await seed({ reset: true, log: () => {} });
const httpServer = createApp().listen(port, () => console.log(`E2E server ready on http://localhost:${port}`));

const stop = async () => {
  httpServer.close();
  await disconnectDB().catch(() => {});
  await mongod.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
