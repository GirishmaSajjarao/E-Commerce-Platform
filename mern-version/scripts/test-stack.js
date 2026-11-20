import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createServer } from 'vite';

process.env.PORT = '15001';
process.env.VITE_API_PROXY = 'http://127.0.0.1:15001';
process.env.CLIENT_ORIGINS = 'http://127.0.0.1:15173';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.MOCK_MODE = process.env.MERN_TEST_LIVE === 'true' ? 'false' : 'true';
process.env.PAYMENT_PROVIDER = 'mock';
const { app } = await import('../server/src/app.js');
const { seed } = await import('../server/src/seed.js');
const replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
let api, web, stopping;
async function stop() {
  if (stopping) return;
  stopping = true;
  await web?.close();
  if (api) await new Promise(resolve => api.close(resolve));
  await mongoose.disconnect();
  await replica.stop();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop().catch(error => { console.error(error.name); process.exitCode = 1; }));
try {
  await mongoose.connect(replica.getUri('store_e2e'));
  await seed();
  api = app.listen(15001, '127.0.0.1');
  await new Promise((resolve, reject) => { api.once('listening', resolve); api.once('error', reject); });
  const root = fileURLToPath(new URL('../client/', import.meta.url));
  web = await createServer({ root, configFile: fileURLToPath(new URL('../client/vite.config.js', import.meta.url)),
    server: { host: '127.0.0.1', port: 15173, strictPort: true, proxy: { '/api': process.env.VITE_API_PROXY } } });
  await web.listen();
} catch (error) {
  console.error('Test stack could not start:', error.message);
  await stop();
  process.exitCode = 1;
}
