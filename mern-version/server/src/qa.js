import { Router } from 'express';
import { z } from 'zod';
import { requireUser, requireAdmin } from './auth.js';
import { SecurityResult, TestRun } from './models.js';
import { HttpError, route } from './http.js';
import { queueSecurity } from './security.js';

export const qa = Router();
qa.use(requireUser, requireAdmin);
qa.post('/security/run', route(async (req, res) => res.status(202).json(await queueSecurity())));
qa.get('/runs', route(async (req, res) => res.json(await TestRun.find().sort({ createdAt: -1 }).limit(100))));
qa.get('/runs/:id', route(async (req, res) => {
  const id = z.string().regex(/^[a-f0-9]{24}$/i).parse(req.params.id);
  const run = await TestRun.findById(id);
  if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run not found.');
  res.json({ run, results: await SecurityResult.find({ run: id }).sort({ key: 1 }) });
}));
