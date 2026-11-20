import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { Cart, Counter, Faq, Order, Payment, Product, Refund, TestCase, User } from './models.js';
import { calculateTotals } from './totals.js';
import { config } from './config.js';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const insert = (model, filter, fields) => model.findOneAndUpdate(filter, { $setOnInsert: fields },
  { upsert: true, new: true, setDefaultsOnInsert: true });

export async function seed() {
  await Promise.all([Cart, Counter, Faq, Order, Payment, Product, Refund, TestCase, User].map(model => model.init()));
  const { customers, products, orders, faqs } = await readJson('./seed-data.json');
  const passwordHash = await bcrypt.hash('Customer@123', 10);
  await insert(User, { email: 'admin@qa.local' }, { name: 'QA Admin', role: 'admin', passwordHash: await bcrypt.hash('Admin@123', 10) });
  const users = new Map();
  for (const [customerId, email, name, phone] of customers) {
    users.set(customerId, await insert(User, { email }, { customerId, name, phone, passwordHash }));
  }
  const catalog = new Map();
  for (const [sku, name, category, description, price, stock] of products) {
    catalog.set(sku, await insert(Product, { sku }, { name, category, description, price: Math.round(price * 100), stock }));
  }
  await Counter.updateOne({ _id: 'order' }, { $max: { value: 1010 } }, { upsert: true });
  for (const [number, customerId, sku, quantity, legacyStatus, date, status, returnStatus, carrier, tracking] of orders) {
    const user = users.get(customerId)._id;
    const product = catalog.get(sku);
    const items = [{ product: product._id, name: product.name, unitPrice: product.price, quantity }];
    const totals = calculateTotals(items, 'standard', config.TAX_RATE);
    const orderStatus = status === 'Failed' ? 'PaymentFailed' : legacyStatus;
    const order = await insert(Order, { number }, {
      user, items, ...totals, status: orderStatus, returnStatus, carrier, tracking, delivery: 'standard',
      deliveredAt: orderStatus === 'Delivered' ? date : undefined,
      statusHistory: [{ status: orderStatus, at: date ? new Date(date) : new Date(), actor: 'seed' }],
    });
    const payment = await insert(Payment, { transactionId: `seed-${number}` }, {
      order: order._id, user, idempotencyKey: `seed-${number}`, provider: 'mock', method: status === 'Pending' ? 'cod' : 'card',
      ...(status === 'Pending' ? {} : { brand: 'Visa', last4: status === 'Failed' ? '0002' : '4242' }),
      status, amount: order.total, failureReason: status === 'Failed' ? 'Card declined' : undefined,
    });
    if (status === 'Refunded') await insert(Refund, { order: order._id }, { payment: payment._id, amount: order.total, reason: 'Seed refund' });
  }
  const alice = users.get('C001')._id;
  await insert(Cart, { user: alice }, { items: [{ product: catalog.get('PRD-112')._id, quantity: 1 }] });
  for (const [key, topic, text] of faqs) await insert(Faq, { key }, { topic, text });
  for (const [file, suite] of [['scenarios', 'evaluation'], ['security_cases', 'security']]) {
    for (const entry of await readJson(`../qa/datasets/${file}.json`)) {
      await insert(TestCase, { key: entry.key }, { suite, category: entry.category, name: entry.name, payload: entry });
    }
  }
}
