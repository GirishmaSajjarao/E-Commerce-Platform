import { Router } from 'express';
import { z } from 'zod';
import { requireUser, requireAdmin } from './auth.js';
import { EvalResult, QaSettings, SecurityResult, TestRun } from './models.js';
import { HttpError, route } from './http.js';
import { queueSecurity } from './security.js';
import { evalKinds, queueEvaluation, queuePromptfoo, validEvalToken } from './evaluations.js';
import { provider } from './providers.js';
import { config } from './config.js';
import { redactPii } from './guard.js';

export const qa = Router();
const runId = z.string().regex(/^[a-f0-9]{24}$/i);
const framework = z.enum(evalKinds);
const settingsInput = z.object({ threshold: z.number().min(0).max(1), hallucination: z.number().min(0).max(1) }).strict();
const settings = async () => (await QaSettings.findById('global').select('-_id threshold hallucination').lean()) || { threshold: 0.7, hallucination: 0.5 };
const metric = z.object({ name: z.string().max(100), score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1), passed: z.boolean(), reason: z.string().max(3000).optional(),
}).strict();
qa.post('/eval-results', route(async (req, res) => {
  if (!validEvalToken(req.get('X-Eval-Token'))) throw new HttpError(403, 'FORBIDDEN', 'Invalid evaluator token.');
  const body = z.object({
    runId, framework, status: z.enum(['completed', 'completed_with_errors', 'failed', 'skipped']),
    error: z.string().max(300).optional(), rows: z.array(z.object({ key: z.string().max(80), metrics: z.array(metric).max(10) }).strict()).max(100),
  }).strict().parse(req.body);
  const run = await TestRun.findOne({ _id: body.runId, kind: body.framework, status: 'running' });
  if (!run) throw new HttpError(409, 'RUN_UNAVAILABLE', 'This evaluation run is no longer active.');
  if ((run.isMock || body.status === 'skipped') && body.rows.length) throw new HttpError(400, 'INVALID_INPUT', 'Skipped and mock evaluations cannot store scores.');
  if (run.isMock && body.status !== 'skipped') throw new HttpError(400, 'INVALID_INPUT', 'Mock evaluations must be skipped.');
  const rows = body.rows.map(row => ({ ...row, run: run._id, framework: body.framework,
    metrics: row.metrics.map(entry => ({ ...entry, ...(entry.reason ? { reason: redactPii(entry.reason) } : {}) })) }));
  await TestRun.db.transaction(async session => {
    const updated = await TestRun.updateOne({ _id: run._id, status: 'running' }, { status: body.status,
      finishedAt: new Date(), summary: { scenarios: rows.length, scores: rows.flatMap(row => row.metrics).length },
      ...(body.error ? { error: redactPii(body.error) } : {}) }, { session });
    if (!updated.modifiedCount) throw new HttpError(409, 'RUN_UNAVAILABLE', 'This evaluation run is no longer active.');
    if (rows.length) await EvalResult.insertMany(rows, { session });
  });
  res.sendStatus(204);
}));
qa.use(requireUser, requireAdmin);
qa.post('/security/run', route(async (req, res) => res.status(202).json(await queueSecurity())));
qa.post('/promptfoo/run', route(async (req, res) => {
  const { rubric } = z.object({ rubric: z.boolean().default(false) }).strict().parse(req.body || {});
  res.status(202).json(await queuePromptfoo(rubric, 'session=' + req.cookies.session));
}));
qa.post('/eval/run', route(async (req, res) => {
  const input = z.object({ framework, limit: z.number().int().min(1).max(100).default(5) }).strict().parse(req.body);
  res.status(202).json(await queueEvaluation(input.framework, await settings(), input.limit));
}));
qa.get('/settings', route(async (req, res) => res.json({ ...await settings(), mock: config.MOCK_MODE, model: config.GEMINI_MODEL })));
qa.put('/settings', route(async (req, res) => {
  await QaSettings.updateOne({ _id: 'global' }, { $set: settingsInput.parse(req.body) }, { upsert: true });
  res.json(await settings());
}));
qa.post('/test-connection', route(async (req, res) => {
  const llm = provider();
  const start = performance.now();
  await llm.generate({ context: [], message: 'Reply only with OK.', connection: true });
  res.json({ ok: true, mock: llm.isMock, latencyMs: Math.round(performance.now() - start) });
}));
qa.get('/runs', route(async (req, res) => res.json(await TestRun.find().sort({ createdAt: -1 }).limit(100))));
async function report(value) {
  const id = runId.parse(value);
  const run = await TestRun.findById(id);
  if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run not found.');
  const [results, evaluations] = await Promise.all([SecurityResult.find({ run: id }).sort({ key: 1 }), EvalResult.find({ run: id }).sort({ _id: 1 })]);
  return { run, results, evaluations };
}
qa.get('/runs/:id', route(async (req, res) => res.json(await report(req.params.id))));
qa.get('/reports/:id', route(async (req, res) => {
  const data = await report(req.params.id);
  res.attachment(`qa-${data.run.id}.json`).json(data);
}));
