import cors from 'cors';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestContext } from './middleware/request-context.js';
import { createApiRouter } from './routes/index.js';
import { AppError } from './lib/errors.js';

export function createApp({ db = prisma } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestContext);
  app.use(pinoHttp({ level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.token'] }));
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.origins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed by BUYSELL CORS policy.'));
    },
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id', 'x-dev-user'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '1mb', verify(req, _res, buffer) { req.rawBody = buffer; } }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use('/api/v1', rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 10_000 : 240,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
  }), createApiRouter({ db }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
