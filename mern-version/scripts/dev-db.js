import { startDevDatabase } from './dev-database.js';
const replica = await startDevDatabase();
console.log(replica.getUri('store'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await replica.stop({ doCleanup: false });
    process.exit(0);
  });
}
