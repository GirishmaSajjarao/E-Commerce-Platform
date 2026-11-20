import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const port = Number(process.env.DEV_MONGO_PORT || 27017);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DEV_MONGO_PORT must be a valid port.');
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', () => reject(new Error(`MongoDB port ${port} is unavailable. Set DEV_MONGO_PORT and update MONGODB_URI to match.`)));
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const dataDirectory = port === 27017 ? 'mongo' : `mongo-${port}`;
const dbPath = fileURLToPath(new URL(`../.data/${dataDirectory}/`, import.meta.url));
await mkdir(dbPath, { recursive: true });
const replica = await MongoMemoryReplSet.create({
  binary: { version: '7.0.14' },
  instanceOpts: [{ ip: '127.0.0.1', port, dbPath, storageEngine: 'wiredTiger' }],
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
});
console.log(replica.getUri('store'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await replica.stop({ doCleanup: false });
    process.exit(0);
  });
}
