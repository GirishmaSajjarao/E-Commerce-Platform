import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { User } from './models.js';
import { HttpError, route } from './http.js';

const credentials = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(72).refine(value => Buffer.byteLength(value) <= 72, 'Password is too long.'),
});
const registration = credentials.extend({ name: z.string().trim().min(1).max(100) }).strict();
const cookie = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
const publicUser = ({ id, name, role, customerId }) => ({ id, name, role, customerId });
const invalidLogin = () => new HttpError(401, 'INVALID_LOGIN', 'Email or password is incorrect.');
const dummyHash = bcrypt.hashSync('invalid-account-password', 10);

function authenticate(res, user, status = 200) {
  const session = jwt.sign({}, config.JWT_SECRET, { subject: user.id, expiresIn: '8h', algorithm: 'HS256' });
  res.cookie('session', session, { ...cookie, maxAge: 8 * 60 * 60 * 1000 }).status(status).json(publicUser(user));
}

export const requireUser = route(async (req, res, next) => {
  let id;
  try {
    id = jwt.verify(req.cookies.session, config.JWT_SECRET, { algorithms: ['HS256'] }).sub;
  } catch {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in.');
  }
  req.user = await User.findById(id);
  if (!req.user) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in.');
  next();
});

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return next(new HttpError(403, 'FORBIDDEN', 'Administrator access is required.'));
  next();
}

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.')),
});
export const auth = Router();
auth.post('/register', loginLimit, route(async (req, res) => {
  const { name, email, password } = registration.parse(req.body);
  const user = await User.create({ name, email, customerId: randomUUID(), passwordHash: await bcrypt.hash(password, 10) });
  authenticate(res, user, 201);
}));
auth.post('/login', loginLimit, route(async (req, res) => {
  const { email, password } = credentials.strict().parse(req.body);
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!await bcrypt.compare(password, user?.passwordHash ?? dummyHash) || !user) throw invalidLogin();
  authenticate(res, user);
}));
auth.post('/logout', (req, res) => res.clearCookie('session', cookie).sendStatus(204));
auth.get('/me', requireUser, (req, res) => res.json(publicUser(req.user)));
