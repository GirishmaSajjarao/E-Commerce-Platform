import { config } from '../server/src/config.js';
const origin = `http://127.0.0.1:${config.PORT}`;
async function request(path, init) {
  const response = await fetch(origin + path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'QA request failed.');
  return { response, data };
}
try {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin@qa.local', password: process.env.QA_ADMIN_PASSWORD || 'Admin@123' }) });
  const headers = { Cookie: login.response.headers.get('set-cookie').split(';', 1)[0], 'Content-Type': 'application/json' };
  const { data: queued } = await request('/api/qa/promptfoo/run', { method: 'POST', headers,
    body: JSON.stringify({ rubric: process.argv.includes('--rubric') }) });
  const end = Date.now() + 250_000;
  while (Date.now() < end) {
    const { data: { run } } = await request('/api/qa/runs/' + queued._id, { headers });
    if (!['queued', 'running'].includes(run.status)) {
      console.log(JSON.stringify({ run: run._id, status: run.status, isMock: run.isMock, summary: run.summary, error: run.error }, null, 2));
      if (run.status !== 'completed' || run.summary?.failed) process.exitCode = 1;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (Date.now() >= end) throw new Error('Promptfoo did not finish before the timeout.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
