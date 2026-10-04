import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import crypto from 'crypto';
import mongoose from 'mongoose';
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
  const tp = env.trustProxy;
  app.set('trust proxy', tp === 'true' ? true : tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : tp);

  // correlate log lines and error reports with a per-request id
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(compression());

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
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    })
  );
  if (!env.isTest) {
    morgan.token('id', (req) => req.id);
    app.use(morgan(env.isProd ? ':id :remote-addr ":method :url" :status :res[content-length] - :response-time ms' : 'dev'));
  }
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(sanitizeInput);

  // liveness: the process is up. readiness: the database is reachable (used by Docker / load balancers).
  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'OK', data: { uptime: process.uptime() } }));
  app.get('/api/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ success: ready, message: ready ? 'Ready' : 'Database not connected' });
  });
  app.use('/api', apiLimiter);
  app.get('/api/files/:category/:filename', protect, serveFile);
  app.use('/api', routes);
  app.use('/api', notFound);

  if (env.serveClient) {
    const dist = path.resolve(SERVER_ROOT, '..', 'client', 'dist');
    if (fs.existsSync(dist)) {
      // hashed build assets are immutable; index.html must always be revalidated
      app.use(
        express.static(dist, {
          index: false,
          setHeaders: (res, file) => {
            if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            else res.setHeader('Cache-Control', 'no-cache');
          },
        })
      );
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(dist, 'index.html'));
      });
    }
  }

  app.use(errorHandler);
  return app;
}
