import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../src/app.js';
import { seed } from '../src/seed.js';
import { Order, User } from '../src/models.js';
import { retrieve } from '../src/chat.js';
import { redactPii } from '../src/guard.js';
import { CANARY, GeminiProvider } from '../src/providers.js';
import { evaluateResponse } from '../src/security.js';

let replica;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri('chat_test'));
  await seed();
});
afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); });
async function login(email, password = 'Customer@123') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}
test('retrieves owned facts, excludes address data, and only includes last four on request', async () => {
  const alice = await User.findOne({ customerId: 'C001' });
  expect(await retrieve('Status of ORD-1004', alice._id)).toEqual({ denied: true, context: [] });
  const owned = (await retrieve('Status of ORD-1001', alice._id)).context.join(' ');
  expect(owned).toContain('Delivered');
  expect(owned).not.toMatch(/QA-STORED|4242|example.com/);
  expect((await retrieve('Last four for ORD-1001', alice._id)).context[0]).toContain('card ending in 4242');
  expect((await retrieve('Could you repeat that?', alice._id, 'Last four for ORD-1001')).context[0]).not.toContain('4242');
});
test('guards PII and evaluates the raw response', () => {
  const pii = ['sample@example.com', '555-123-4567', Array(4).fill('4242').join(' ')].join(', ');
  expect(redactPii(pii)).toBe('[email removed], [phone removed], [number removed]');
  expect(redactPii('delivered 2026-11-20')).toBe('delivered 2026-11-20');
  expect(evaluateResponse({ expect: 'refuse' }, "I can't help with that. " + CANARY + ' ' + pii).passed).toBe(false);
  expect(evaluateResponse({ expect: 'answer', must_contain_any: ['Paid'] }, '[MOCK RESPONSE] Paid').passed).toBe(true);
});
test('Gemini maps quota, invalid key and blocked responses with bounded retries', async () => {
  const fetcher = jest.fn().mockImplementation(() => new Response('{}', { status: 429 }));
  const options = { key: 'fixture', fetcher, wait: jest.fn() };
  const gemini = new GeminiProvider(options);
  await expect(gemini.generate({ message: 'test', context: [] })).rejects.toMatchObject({ code: 'quota' });
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockImplementation(() => new Response('{}', { status: 403 }));
  await expect(gemini.generate({ message: 'test', context: [] })).rejects.toMatchObject({ code: 'invalid_key' });
  fetcher.mockImplementation(() => new Response('{}'));
  await expect(gemini.generate({ message: 'test', context: [] })).rejects.toMatchObject({ code: 'blocked' });
});

test('protects conversations and requires confirmation before cancelling', async () => {
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');
  const { body } = await alice.post('/api/chat/conversations').send({ orderNumber: 'ORD-1003' }).expect(201);
  const path = '/api/chat/conversations/' + body.id + '/messages';
  await bob.get(path).expect(403);
  const prompt = await alice.post(path).send({ content: 'Cancel order ORD-1003' }).expect(200);
  expect(prompt.body.content).toMatch(/MOCK RESPONSE.*confirm/);
  expect((await Order.findOne({ number: 'ORD-1003' })).status).toBe('Processing');
  await alice.post(path).send({ content: 'confirm' }).expect(200);
  expect((await Order.findOne({ number: 'ORD-1003' })).status).toBe('Cancelled');
  expect((await alice.get(path).expect(200)).body[1]).not.toHaveProperty('rawContent');
});

test('stores actual mock security results with explicit mock flags', async () => {
  const admin = await login('admin@qa.local', 'Admin@123');
  const queued = await admin.post('/api/qa/security/run').expect(202);
  const path = '/api/qa/runs/' + queued.body._id;
  let report;
  for (let attempt = 0; attempt < 40; attempt++) {
    report = (await admin.get(path).expect(200)).body;
    if (!['queued', 'running'].includes(report.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  expect(report.run).toMatchObject({ isMock: true, status: 'completed', summary: { total: 26, errors: 0 } });
  expect(report.results).toHaveLength(26);
  expect(report.results.every(result => result.isMock && result.answer.startsWith('[MOCK RESPONSE]'))).toBe(true);
  expect(report.results.filter(result => !result.passed).map(result => result.key)).toEqual([]);
});

test('skips evaluator jobs in mock mode and refuses unauthorized uploads', async () => {
  const admin = await login('admin@qa.local', 'Admin@123');
  await request(app).post('/api/qa/eval-results').send({}).expect(403);
  const { body: queued } = await admin.post('/api/qa/eval/run').send({ framework: 'ragas', limit: 3 }).expect(202);
  let report;
  for (let attempt = 0; attempt < 30; attempt++) {
    report = (await admin.get('/api/qa/runs/' + queued._id).expect(200)).body;
    if (report.run.status === 'skipped') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  expect(report.run).toMatchObject({ status: 'skipped', isMock: true });
  expect(report.evaluations).toEqual([]);
  await admin.get('/api/qa/reports/' + queued._id).expect('Content-Disposition', /attachment/).expect(200);
});
