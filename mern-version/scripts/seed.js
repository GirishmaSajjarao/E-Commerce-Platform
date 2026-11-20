import mongoose from 'mongoose';
import { config } from '../server/src/config.js';
import { seed } from '../server/src/seed.js';
import { developmentPort, startDevDatabase } from './dev-database.js';
let database;
try {
  try {
    await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  } catch (error) {
    const port = developmentPort();
    if (!config.MONGODB_URI.startsWith(`mongodb://127.0.0.1:${port}/store?`) ||
      !config.MONGODB_URI.includes('replicaSet=rs0')) throw error;
    await mongoose.disconnect();
    console.log('Starting the development replica set for seeding.');
    database = await startDevDatabase(port);
    await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  }
  await seed();
  console.log('Sample users, products, orders, payments, cart, FAQs and QA cases seeded.');
} catch (error) {
  console.error(`Seed failed (${error.name}). Verify the database is running and MONGODB_URI is correct.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  await database?.stop({ doCleanup: false });
}
