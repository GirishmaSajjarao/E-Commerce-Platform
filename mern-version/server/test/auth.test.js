import { afterAll, beforeAll, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { User, Product, Order, Payment } from '../src/models.js';
import { seed } from '../src/seed.js';

let replica;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri('store_test'));
  await seed();
});
afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); });

test('registers, starts a cookie session and logs out', async () => {
  const agent = request.agent(app);
  const signup = await agent.post('/api/auth/register').send({ name: 'Taylor', email: 'taylor@example.com', password: 'testpass123' }).expect(201);
  expect(signup.body).toMatchObject({ role: 'customer', name: 'Taylor' });
  expect(signup.headers['set-cookie'][0]).toMatch(/HttpOnly.*SameSite=Lax/);
  await agent.get('/api/auth/me').expect(200);
  await agent.post('/api/auth/logout').expect(204);
  await agent.get('/api/auth/me').expect(401);
});

test('protects admin routes and handles bad credentials', async () => {
  const customer = request.agent(app);
  const admin = request.agent(app);
  await customer.post('/api/auth/login').send({ email: 'alice@example.com', password: 'incorrect' }).expect(401);
  await customer.post('/api/auth/login').send({ email: 'alice@example.com', password: 'Customer@123' }).expect(200);
  await customer.get('/api/admin/session').expect(403);
  await admin.post('/api/auth/login').send({ email: 'admin@qa.local', password: 'Admin@123' }).expect(200);
  await admin.get('/api/admin/session').expect(200, { role: 'admin' });
});

test('seeding preserves existing records and does not duplicate them', async () => {
  await Product.updateOne({ sku: 'PRD-101' }, { stock: 7 });
  const userCount = await User.countDocuments();
  await seed();
  expect(await User.countDocuments()).toBe(userCount);
  expect(await Product.countDocuments()).toBe(12);
  expect(await Order.countDocuments()).toBe(10);
  expect(await Payment.countDocuments()).toBe(10);
  expect((await Product.findOne({ sku: 'PRD-101' })).stock).toBe(7);
});
