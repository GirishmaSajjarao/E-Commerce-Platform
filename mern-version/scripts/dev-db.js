import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const dbPath = fileURLToPath(new URL('../.data/mongo/', import.meta.url));
await mkdir(dbPath, { recursive: true });
const replica = await MongoMemoryReplSet.create({
  binary: { version: '7.0.14' },
  instanceOpts: [{ ip: '127.0.0.1', port: 27017, dbPath, storageEngine: 'wiredTiger' }],
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
});
console.log(replica.getUri('store'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await replica.stop({ doCleanup: false });
    process.exit(0);
  });
}
