import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swagger from 'swagger-ui-express';
import mongoose from 'mongoose';
import { auth, requireUser, requireAdmin } from './auth.js';
import { commerce } from './commerce-routes.js';
import { config } from './config.js';
import { handleError, HttpError, rejectUnsafeKeys } from './http.js';

export const app = express();
app.disable('x-powered-by');
app.use(pinoHttp({
  genReqId: (req, res) => { const id = randomUUID(); res.setHeader('X-Request-Id', id); return id; },
  serializers: { req: req => ({ id: req.id, method: req.method }), res: res => ({ statusCode: res.statusCode }), err: error => ({ type: error.type }) },
  quietReqLogger: true,
}));
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.CLIENT_ORIGINS.includes(origin)) return callback(null, true);
    callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '64kb' }), cookieParser());
app.use((req, res, next) => { rejectUnsafeKeys(req.body); rejectUnsafeKeys(req.query); next(); });
app.use('/api', rateLimit({
  windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')),
}));
app.get('/api/health', (req, res) => {
  if (mongoose.connection.readyState !== 1) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database is not ready.');
  res.json({ status: 'ok' });
});
app.use('/api/auth', auth);
app.use('/api', commerce);
app.get('/api/admin/session', requireUser, requireAdmin, (req, res) => res.json({ role: req.user.role }));
app.use('/api/docs', swagger.serve, swagger.setup({
  openapi: '3.0.3', info: { title: 'Store and Support API', version: '1.0.0' },
  paths: Object.fromEntries([['get', '/api/health'], ['post', '/api/auth/register'], ['post', '/api/auth/login'], ['post', '/api/auth/logout'], ['get', '/api/auth/me']].map(([method, path]) => [path, { [method]: { responses: { [path.endsWith('logout') ? 204 : path.endsWith('register') ? 201 : 200]: { description: 'Success' } } } }])),
}));
app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found.')));
app.use(handleError);
