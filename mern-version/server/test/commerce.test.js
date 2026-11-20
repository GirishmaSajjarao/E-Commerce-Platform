import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { Order, Payment, Product, Refund } from '../src/models.js';
import { seed } from '../src/seed.js';
import { calculateTotals } from '../src/totals.js';

let replica;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri('commerce_test'));
  await seed();
});
afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); });
async function login(email, password = 'Customer@123') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}
const attempt = (segments, overrides) => ({
  idempotencyKey: randomUUID(), delivery: 'standard', method: 'card', card: segments.join(' '),
  address: { name: 'Sample Buyer', phone: '555-0102', street: '10 Sample Lane', city: 'Sample City', postalCode: '10001' },
  ...overrides,
});

test('computes integer cents with standard and express shipping', () => {
  expect(calculateTotals([{ unitPrice: 5000, quantity: 1 }], 'standard', .08)).toEqual({ subtotal: 5000, shipping: 500, tax: 400, total: 5900 });
  expect(calculateTotals([{ unitPrice: 5001, quantity: 1 }], 'standard', .08).shipping).toBe(0);
  expect(calculateTotals([{ unitPrice: 5001, quantity: 1 }], 'express', .08).shipping).toBe(1200);
});

test('charges once, computes trusted totals, protects ownership and refunds on cancellation', async () => {
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');
  await alice.delete('/api/cart/items/PRD-112').expect(200);
  await alice.put('/api/cart/items/PRD-103').send({ quantity: 2 }).expect(200);
  const before = await Product.findOne({ sku: 'PRD-103' });
  const payload = attempt(['4242', '4242', '4242', '4242'], { total: 1, shipping: 0 });
  const [first, retry] = await Promise.all([
    alice.post('/api/checkout').send(payload).expect(201),
    alice.post('/api/payments/confirm').send(payload).expect(201),
  ]);
  const { number, subtotal, shipping, tax, total } = first.body.order;
  expect(number).toBe(retry.body.order.number);
  expect(subtotal).toBe(before.price * 2);
  expect(total).toBe(subtotal + shipping + tax);
  expect(first.body.payment.status).toBe('Paid');
  expect(await Payment.countDocuments({ idempotencyKey: payload.idempotencyKey })).toBe(1);
  expect((await Product.findById(before._id)).stock).toBe(before.stock - 2);
  await bob.get(`/api/my/orders/${number}`).expect(403);
  await alice.post(`/api/my/orders/${number}/cancel`).expect(200);
  await alice.post(`/api/my/orders/${number}/cancel`).expect(200);
  expect((await Product.findById(before._id)).stock).toBe(before.stock);
  const order = await Order.findOne({ number });
  expect(await Refund.countDocuments({ order: order._id })).toBe(1);
});

test('declined and insufficient-funds cards leave stock, cart and order counts intact', async () => {
  const bob = await login('bob@example.com');
  await bob.put('/api/cart/items/PRD-101').send({ quantity: 1 }).expect(200);
  await bob.put('/api/cart/items/PRD-102').send({ quantity: 1 }).expect(409);
  const orders = await Order.countDocuments();
  const stock = (await Product.findOne({ sku: 'PRD-101' })).stock;
  for (const [last4, message] of [['0002', 'Card declined.'], ['9995', 'Insufficient funds.']]) {
    const fields = attempt(['4000', '0000', '0000', last4]);
    const { body } = await bob.post('/api/checkout').send(fields).expect(402);
    expect(body.error.message).toBe(message);
    const payment = await Payment.findOne({ idempotencyKey: fields.idempotencyKey }).lean();
    expect(payment).toMatchObject({ last4, status: 'Failed' });
    expect(payment.order).toBeUndefined();
    expect(JSON.stringify(payment).includes(fields.card.replaceAll(' ', ''))).toBe(false);
  }
  expect(await Order.countDocuments()).toBe(orders);
  expect((await Product.findOne({ sku: 'PRD-101' })).stock).toBe(stock);
  expect((await bob.get('/api/cart').expect(200)).body.items).toHaveLength(1);
});

test('advances a COD order, exposes tracking, and refunds an approved return', async () => {
  const bob = await login('bob@example.com');
  const admin = await login('admin@qa.local', 'Admin@123');
  await bob.put('/api/cart/items/PRD-103').send({ quantity: 1 }).expect(200);
  const { body } = await bob.post('/api/checkout').send(attempt([], { method: 'cod', delivery: 'express' })).expect(201);
  expect(body.payment.status).toBe('Pending');
  const path = `/api/admin/orders/${body.order.number}`;
  await bob.patch(path + '/status').send({ status: 'Processing' }).expect(403);
  await admin.patch(path + '/status').send({ status: 'Delivered' }).expect(409);
  await admin.patch(path + '/status').send({ status: 'Processing' }).expect(200);
  await admin.patch(path + '/status').send({ status: 'Shipped', carrier: 'Sample Carrier', tracking: 'TRACK-001' }).expect(200);
  const customerPath = `/api/my/orders/${body.order.number}`;
  expect((await bob.get(customerPath).expect(200)).body.tracking).toBe('TRACK-001');
  await bob.post(customerPath + '/cancel').expect(409);
  await admin.patch(path + '/status').send({ status: 'Delivered' }).expect(200);
  await bob.post(customerPath + '/return').expect(200);
  expect((await admin.patch(path + '/return').send({ decision: 'Approved' }).expect(200)).body.payment.status).toBe('Refunded');
  expect(await Product.countDocuments({ stock: { $lt: 0 } })).toBe(0);
});

test('protects admin records and derives sales from stored payments and orders', async () => {
  const admin = await login('admin@qa.local', 'Admin@123');
  const alice = await login('alice@example.com');
  for (const item of ['customers', 'payments', 'carts', 'products', 'sales-summary']) {
    await alice.get('/api/admin/' + item).expect(403);
  }
  const customers = (await admin.get('/api/admin/customers').expect(200)).body;
  expect(customers.find(row => row.email === 'alice@example.com')).toHaveProperty('phone');
  expect(customers.every(row => !Object.hasOwn(row, 'passwordHash'))).toBe(true);
  const payments = (await admin.get('/api/admin/payments').expect(200)).body;
  expect(payments.every(row => !Object.hasOwn(row, 'last4'))).toBe(true);
  const sales = (await admin.get('/api/admin/sales-summary').expect(200)).body;
  expect(sales.revenue).toBe(payments.filter(row => row.status === 'Paid').reduce((sum, row) => sum + row.amount, 0));
  expect(sales.ordersPerDay.reduce((sum, row) => sum + row.count, 0)).toBe(await Order.countDocuments());
  await admin.post('/api/admin/products').send({
    sku: 'TEST-SKU', name: 'Sample', category: 'Other', description: 'Sample inventory product', price: 500, stock: 3, active: true,
  }).expect(201);
  await admin.patch('/api/admin/products/TEST-SKU').send({ price: 800, stock: 4, active: false }).expect(200);
  await admin.patch('/api/admin/products/TEST-SKU').send({ stock: -1 }).expect(400);
  await alice.get('/api/products/TEST-SKU').expect(404);
});
