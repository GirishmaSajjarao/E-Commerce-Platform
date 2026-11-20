import mongoose from 'mongoose';
import { app } from './app.js';
import { config } from './config.js';
import { failInterruptedRuns } from './evaluations.js';

try {
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 120_000 });
  await failInterruptedRuns();
  const server = app.listen(config.PORT, '127.0.0.1', () => console.log(`API listening at http://127.0.0.1:${config.PORT}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => { await mongoose.disconnect(); }));
  }
} catch (error) {
  console.error(`Database connection failed (${error.name}). Verify MONGODB_URI and start the replica set.`);
  process.exitCode = 1;
}
