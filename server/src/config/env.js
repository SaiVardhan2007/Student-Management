import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const PLACEHOLDERS = ['change_this_secret', 'change_this_refresh_secret', ''];

function secret(name, devFallback) {
  const v = process.env[name];
  if (isProd && (!v || PLACEHOLDERS.includes(v) || v.length < 32)) {
    throw new Error(`${name} must be set to a strong random value (32+ chars) in production`);
  }
  return v || devFallback;
}

const uploadDir = process.env.UPLOAD_DIR || 'uploads';

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT) || 5000,
  mongoUri:
    nodeEnv === 'test'
      ? process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/student_management_test'
      : process.env.MONGODB_URI || 'mongodb://localhost:27017/student_management',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  // extra allowed browser origins, comma separated (CLIENT_URL is always allowed)
  corsOrigins: [process.env.CLIENT_URL || 'http://localhost:5173', ...(process.env.CORS_ORIGINS || '').split(',')]
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  jwtSecret: secret('JWT_SECRET', 'dev-only-access-secret-do-not-use-in-prod'),
  jwtRefreshSecret: secret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-do-not-use-in-prod'),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  jwtRefreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS) || 7,
  uploadDir: path.isAbsolute(uploadDir) ? uploadDir : path.join(SERVER_ROOT, uploadDir),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 10,
  serveClient: process.env.SERVE_CLIENT === 'true',
  // set COOKIE_SECURE=true when the site is served over HTTPS (behind a TLS proxy)
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY ?? '1',
  apiRateLimit: Number(process.env.API_RATE_LIMIT) || 1000,
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  lockoutMaxAttempts: Number(process.env.LOCKOUT_MAX_ATTEMPTS) || 5,
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES) || 15,
  allowDemoSeed: process.env.ALLOW_DEMO_SEED === 'true',
  seedPassword: process.env.SEED_PASSWORD || 'ChangeMe@123',
};
