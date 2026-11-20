import { config } from '../server/src/config.js';
import mongoose from 'mongoose';
async function check(label, checkValue) {
  try { console.log(label + ': ' + await checkValue()); }
  catch (error) { console.error(label + ': ' + error.message); process.exitCode = 1; }
}
console.log('Node.js: ' + process.version);
console.log('Chat mode: ' + (config.MOCK_MODE ? 'MOCK' : config.GEMINI_MODEL));
console.log('Evaluator token: ' + (config.EVAL_SERVICE_TOKEN ? 'configured' : 'missing'));
await check('MongoDB', async () => {
  try {
    await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error();
    return 'replica set ready';
  } catch {
    throw new Error('Start the development replica set or verify server/.env.');
  } finally { await mongoose.disconnect(); }
});
await check('API', async () => {
  const response = await fetch(`http://127.0.0.1:${config.PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Health endpoint returned ' + response.status);
  return 'ready';
});
