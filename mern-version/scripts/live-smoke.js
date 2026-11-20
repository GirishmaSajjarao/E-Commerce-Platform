const url = process.env.API_URL || 'http://127.0.0.1:15001';
let cookie;
async function api(path, body) {
  const response = await fetch(url + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Smoke request failed with HTTP ${response.status}`);
  if (path === '/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return response.json();
}
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for the live smoke test.');
await api('/auth/login', { email: process.env.QA_ADMIN_EMAIL || 'admin@qa.local', password: process.env.QA_ADMIN_PASSWORD || 'Admin@123' });
const queued = await Promise.all(['deepeval', 'ragas'].map(framework => api('/qa/eval/run', { framework, limit: 3 })));
for (const job of queued) {
  const deadline = Date.now() + 600_000;
  while (true) {
    const { run } = await api('/qa/runs/' + job._id);
    if (!['queued', 'running'].includes(run.status)) {
      if (run.status !== 'completed' || run.summary?.scenarios !== 3 || !run.summary.scores) {
        throw new Error(`${run.kind}: ${run.status}. ${run.error || 'Expected three scored scenarios.'}`);
      }
      console.log(`${run.kind}: ${run.summary.scenarios} scenarios, ${run.summary.scores} scores.`);
      break;
    }
    if (Date.now() > deadline) throw new Error('Live evaluation timed out.');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
