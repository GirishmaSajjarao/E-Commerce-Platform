import mongoose from 'mongoose';
import { config } from '../server/src/config.js';
import { seed } from '../server/src/seed.js';
try {
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  await seed();
  console.log('Sample users, products, orders, payments, cart, FAQs and QA cases seeded.');
} catch (error) {
  console.error(`Seed failed (${error.name}). Verify the database is running and MONGODB_URI is correct.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
