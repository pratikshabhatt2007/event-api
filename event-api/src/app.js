import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { HttpError, notFound } from './errors.js';
import { createAuth } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';

export function createApp(db, { rateLimiting = true } = {}) {
  const app = express();
  const auth = createAuth(db);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '100kb' }));

  const passthrough = (_req, _res, next) => next();
  const limiter = (max) =>
    rateLimiting
      ? rateLimit({
          windowMs: 15 * 60 * 1000,
          limit: max,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          message: { error: { message: 'Too many requests, please try again later.' } },
        })
      : passthrough;

  app.use('/api', limiter(config.rateLimitMax));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes(db, auth, limiter(config.authRateLimitMax)));
  app.use('/api/events', eventRoutes(db, auth));
  app.use('/api/me', meRoutes(db, auth));
  app.use('/api/admin', adminRoutes(db, auth));

  app.use((_req, _res, next) => next(notFound('Route not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { message: err.message, details: err.details } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { message: 'Malformed JSON body' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { message: 'Request body too large' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Internal server error' } });
  });

  return app;
}
