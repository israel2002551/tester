import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { env } from './config/env.js';
import { optionalAuth } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { apiRouter } from './routes.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin(origin, callback) {
  if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS'));
}, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));
if (env.storageDriver !== 's3') app.use('/uploads', express.static(path.resolve(env.storageLocalDir)));
app.use(optionalAuth);
app.use('/api/v1', apiRouter);
app.use(notFound);
app.use(errorHandler);

app.listen(env.port, '0.0.0.0', () => console.log(`BUYSELL API listening on :${env.port}`));
