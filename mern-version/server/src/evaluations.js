import { timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { EvalResult, TestCase, TestRun } from './models.js';
import { HttpError } from './http.js';

export const evalKinds = ['deepeval', 'ragas'];
const pending = ['queued', 'running'];
export function validEvalToken(value) {
  if (!config.EVAL_SERVICE_TOKEN || typeof value !== 'string') return false;
  const expected = Buffer.from(config.EVAL_SERVICE_TOKEN);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function failInterruptedRuns() {
  return TestRun.updateMany({ status: { $in: pending } }, {
    status: 'failed', finishedAt: new Date(), error: 'The API restarted before the job finished.',
  });
}
async function finish(id, status, fields = {}) {
  await TestRun.updateOne({ _id: id, status: { $in: pending } }, { status, finishedAt: new Date(), ...fields });
}

export async function queueEvaluation(framework, settings, limit) {
  const run = await TestRun.create({ kind: framework, status: 'queued', isMock: config.MOCK_MODE });
  setImmediate(async () => {
    try {
      await TestRun.updateOne({ _id: run.id, status: 'queued' }, { status: 'running' });
      if (config.MOCK_MODE && !config.EVAL_SERVICE_TOKEN) {
        await finish(run.id, 'skipped', { error: 'Mock mode is enabled. No LLM scores were generated.' });
        return;
      }
      if (!config.EVAL_SERVICE_TOKEN) throw new HttpError(503, 'EVAL_TOKEN_MISSING', 'Set EVAL_SERVICE_TOKEN in the API and evaluator environments.');
      const scenarios = await TestCase.find({ suite: 'evaluation' }).sort({ key: 1 }).limit(limit).lean();
      await fetch(new URL('/evaluate', config.EVAL_SERVICE_URL), {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', 'X-Eval-Token': config.EVAL_SERVICE_TOKEN },
        body: JSON.stringify({ runId: run.id, framework, settings, mock: config.MOCK_MODE, scenarios: scenarios.map(row => row.payload) }),
      }).then(response => {
        if (!response.ok) throw new HttpError(502, 'EVALUATOR_ERROR', 'The evaluator rejected the request. Check the service token and configuration.');
      });
    } catch (error) {
      if (config.MOCK_MODE) await finish(run.id, 'skipped', { error: 'Mock mode is enabled. No LLM scores were generated.' });
      else await finish(run.id, 'failed', { error: error instanceof HttpError ? error.message : 'Could not reach the evaluation service. Start it and retry.' });
    }
  });
  return run;
}

const runner = fileURLToPath(new URL('../qa/promptfoo/', import.meta.url));
const binary = fileURLToPath(new URL('../../node_modules/promptfoo/dist/src/entrypoint.js', import.meta.url));
function runPromptfoo(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PROMPTFOO_NODE_BINARY || process.execPath, [binary, ...args], {
      cwd: runner, stdio: 'ignore', env, windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), 240_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
}
export async function queuePromptfoo(rubric, cookie) {
  const run = await TestRun.create({ kind: rubric ? 'promptfoo-rubric' : 'promptfoo', status: 'queued', isMock: config.MOCK_MODE });
  setImmediate(async () => {
    try {
      if (rubric && config.MOCK_MODE) return await finish(run.id, 'skipped', { error: 'Rubric grading requires a live Gemini judge.' });
      if (!process.env.PROMPTFOO_NODE_BINARY && Number(process.versions.node.split('.')[0]) < 22) {
        return await finish(run.id, 'failed', { error: 'Promptfoo requires Node 22.22 or newer. Set PROMPTFOO_NODE_BINARY to its executable.' });
      }
      await TestRun.updateOne({ _id: run.id, status: 'queued' }, { status: 'running' });
      const directory = new URL('../../.data/promptfoo/', import.meta.url);
      await mkdir(directory, { recursive: true });
      const output = fileURLToPath(new URL(run.id + '.json', directory));
      const code = await runPromptfoo(['eval', '-c', rubric ? 'promptfooconfig.rubric.yaml' : 'promptfooconfig.yaml',
        '--no-cache', '--no-table', '--max-concurrency', '1', '-o', output], {
        ...process.env, PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1',
        PROMPTFOO_CONFIG_DIR: fileURLToPath(directory), PROMPTFOO_SESSION: cookie,
        PROMPTFOO_API_URL: `http://127.0.0.1:${config.PORT}`,
      });
      const data = JSON.parse(await readFile(output, 'utf8'));
      const entries = data.results?.results;
      if (!Array.isArray(entries) || !entries.length) throw new Error('Promptfoo emitted no result rows.');
      const rows = entries.map((row, index) => ({
        run: run.id, framework: run.kind, key: String(index + 1),
        result: { passed: Boolean(row.success), error: Boolean(row.response?.error || !row.response?.output && row.error),
          description: row.testCase?.description || ('Check ' + (index + 1)) },
      }));
      await EvalResult.insertMany(rows);
      const errors = rows.filter(row => row.result.error).length;
      const passed = rows.filter(row => row.result.passed).length;
      await finish(run.id, errors ? 'completed_with_errors' : 'completed', { summary: {
        total: rows.length, passed, failed: rows.length - passed - errors, errors, exitCode: code,
      } });
    } catch {
      await finish(run.id, 'failed', { error: 'Promptfoo could not produce results. Verify the installed CLI and chatbot API.' }).catch(() => {});
    }
  });
  return run;
}
