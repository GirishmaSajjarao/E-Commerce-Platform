import mongoose from 'mongoose';
const { Schema } = mongoose;
const ref = name => ({ type: Schema.Types.ObjectId, ref: name, required: true });
const model = (name, fields, indexes = []) => {
  const schema = new Schema(fields, { timestamps: true });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.model(name, schema);
};
const unique = { type: String, required: true, unique: true };
const integer = { type: Number, min: 0, validate: Number.isInteger, required: true };
const orderStatuses = ['PendingPayment', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'PaymentFailed'];
export const User = model('User', {
  email: unique, customerId: { type: String, unique: true, sparse: true }, name: { type: String, required: true },
  phone: String, passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
});
export const Product = model('Product', {
  sku: unique, name: String, description: String, category: String, price: integer,
  stock: integer, active: { type: Boolean, default: true },
});
export const Cart = model('Cart', {
  user: { ...ref('User'), unique: true },
  items: [{ _id: false, product: ref('Product'), quantity: { type: Number, min: 1, max: 10, validate: Number.isInteger } }],
});
export const Order = model('Order', {
  number: unique, user: ref('User'),
  items: [{ _id: false, product: ref('Product'), name: String, unitPrice: integer, quantity: integer }],
  status: { type: String, enum: orderStatuses, required: true },
  statusHistory: [{ _id: false, status: String, at: Date, actor: String }],
  address: { name: String, phone: String, street: String, city: String, postalCode: String },
  subtotal: integer, shipping: integer, tax: integer, total: integer,
  delivery: String, deliveryEstimate: { from: Date, to: Date }, deliveredAt: Date, carrier: String, tracking: String,
  returnStatus: { type: String, default: 'None' },
}, [[{ user: 1, createdAt: -1 }]]);
export const Payment = model('Payment', {
  order: { type: Schema.Types.ObjectId, ref: 'Order' }, user: ref('User'), idempotencyKey: { type: String, required: true },
  provider: String, transactionId: unique, method: String, brand: String, last4: { type: String, match: /^\d{4}$/ },
  amount: integer, currency: { type: String, default: 'USD' },
  status: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Refunded'], required: true }, failureReason: String,
}, [[{ user: 1, idempotencyKey: 1 }, { unique: true }], [{ order: 1 }, { unique: true, sparse: true }]]);
export const Refund = model('Refund', { order: { ...ref('Order'), unique: true }, payment: ref('Payment'), amount: integer, reason: String });
export const Counter = model('Counter', { _id: String, value: integer });
export const Faq = model('Faq', { key: unique, topic: String, text: String });
export const Conversation = model('Conversation', { user: ref('User'), customer: ref('User'), title: String, order: Schema.Types.ObjectId, pendingAction: Schema.Types.Mixed }, [[{ user: 1, updatedAt: -1 }]]);
export const Message = model('Message', { conversation: ref('Conversation'), role: String, content: String, rawContent: String, context: [String], latencyMs: Number, isMock: Boolean, flagged: Boolean }, [[{ conversation: 1, createdAt: 1 }]]);
export const TestCase = model('TestCase', { key: unique, suite: String, category: String, name: String, payload: Schema.Types.Mixed });
export const TestRun = model('TestRun', { kind: String, status: String, isMock: Boolean, error: String, summary: Schema.Types.Mixed, finishedAt: Date });
export const EvalResult = model('EvalResult', { run: ref('TestRun'), framework: String, key: String, metrics: Schema.Types.Mixed, result: Schema.Types.Mixed });
export const SecurityResult = model('SecurityResult', { run: ref('TestRun'), key: String, passed: Boolean, isMock: Boolean, answer: String, findings: [String] });
