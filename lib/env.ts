// All environment variables read in one place, with defaults.
import path from 'path';

/**
 * Central, lazily-evaluated configuration. Secrets are validated when first used (not at import time) so
 * `next build` works without a populated environment.
 */
const PLACEHOLDERS = ['change_this_secret', 'change_this_refresh_secret', ''];

function secret(name: string, devFallback: string): string {
  const v = process.env[name];
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && (!v || PLACEHOLDERS.includes(v) || v.length < 32)) {
    throw new Error(`${name} must be set to a strong random value (32+ chars) in production`);
  }
  return v || devFallback;
}

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV || 'development';
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
  get isTest() {
    return process.env.NODE_ENV === 'test';
  },
  get mongoUri() {
    return process.env.MONGODB_URI || 'mongodb://localhost:27017/student_management';
  },
  get appUrl() {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  },
  get jwtSecret() {
    return secret('JWT_SECRET', 'dev-only-access-secret-do-not-use-in-prod');
  },
  get jwtRefreshSecret() {
    return secret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-do-not-use-in-prod');
  },
  get jwtAccessExpires() {
    return process.env.JWT_ACCESS_EXPIRES || '15m';
  },
  get jwtRefreshExpiresDays() {
    return num(process.env.JWT_REFRESH_EXPIRES_DAYS, 7);
  },
  get uploadDir() {
    const dir = process.env.UPLOAD_DIR || 'uploads';
    return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  },
  // 'disk' (default) or 'gridfs' (store uploads in MongoDB — for hosts without a persistent disk)
  get storage() {
    return process.env.STORAGE === 'gridfs' ? 'gridfs' : 'disk';
  },
  get maxFileSizeMb() {
    return num(process.env.MAX_FILE_SIZE_MB, 10);
  },
  // set COOKIE_SECURE=true when the site is served over HTTPS
  get cookieSecure() {
    return process.env.COOKIE_SECURE === 'true';
  },
  get trustProxy() {
    return num(process.env.TRUST_PROXY, 0);
  },
  get apiRateLimit() {
    return num(process.env.API_RATE_LIMIT, 1000);
  },
  get authRateLimit() {
    return num(process.env.AUTH_RATE_LIMIT, 20);
  },
  get lockoutMaxAttempts() {
    return num(process.env.LOCKOUT_MAX_ATTEMPTS, 5);
  },
  get lockoutMinutes() {
    return num(process.env.LOCKOUT_MINUTES, 15);
  },
  // SMTP for outgoing mail (password reset, faculty approval). Without SMTP_HOST, mails are only written to the log.
  get smtp() {
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    const port = num(process.env.SMTP_PORT, 587);
    return {
      host,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  },
  get mailFrom() {
    return process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
  },
  // Razorpay payment gateway. Fee payments through the gateway are disabled until both keys are set.
  get razorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keyId || !keySecret) return null;
    return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '' };
  },
  get allowDemoSeed() {
    return process.env.ALLOW_DEMO_SEED === 'true';
  },
  get seedPassword() {
    return process.env.SEED_PASSWORD || 'ChangeMe@123';
  },
};
