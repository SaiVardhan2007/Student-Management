import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { env, SERVER_ROOT } from './config/env.js';
import { sanitizeInput, apiLimiter } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/error.js';
import { protect } from './middleware/auth.js';
import { serve as serveFile } from './controllers/files.controller.js';
import routes from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: {
        useDefaults: true,
        // avatars/logos are fetched with the auth header and shown from blob: URLs
        // the app is served over plain http on localhost, so do not force https upgrades
        directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'upgrade-insecure-requests': null },
      },
    })
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // same-origin / curl / server-to-server requests have no Origin header
        if (!origin || origin === env.clientUrl) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    })
  );
  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(sanitizeInput);

  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'OK', data: { uptime: process.uptime() } }));
  app.use('/api', apiLimiter);
  app.get('/api/files/:category/:filename', protect, serveFile);
  app.use('/api', routes);
  app.use('/api', notFound);

  if (env.serveClient) {
    const dist = path.resolve(SERVER_ROOT, '..', 'client', 'dist');
    if (fs.existsSync(dist)) {
      app.use(express.static(dist));
      app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
  }

  app.use(errorHandler);
  return app;
}
