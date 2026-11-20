import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { HttpError, route } from './http.js';
import { requireAdmin, requireUser } from './auth.js';
import { Order, Payment, Product } from './models.js';
import { advanceOrder, cancelOrder, cartView, checkout, findOrder, paymentSummary, requestReturn, resolveReturn, updateCart } from './commerce.js';

const shortText = z.string().trim().min(1).max(100);
const sku = z.string().regex(/^[A-Z0-9-]{1,32}$/);
const number = z.string().regex(/^ORD-\d{4,12}$/);
const address = z.object({
  name: shortText, phone: z.string().regex(/^\+?[0-9 ().-]{7,20}$/),
  street: z.string().trim().min(3).max(200), city: shortText, postalCode: z.string().trim().min(3).max(16),
}).strict();
const checkoutBase = z.object({ idempotencyKey: z.string().uuid(), address, delivery: z.enum(['standard', 'express']) });
const checkoutInput = z.discriminatedUnion('method', [
  checkoutBase.extend({ method: z.literal('card'), card: z.string().transform(card => card.replace(/[ -]/g, '')).pipe(z.string().regex(/^\d{16}$/)) }),
  checkoutBase.extend({ method: z.literal('upi'), upi: z.enum(['success', 'failure']) }),
  checkoutBase.extend({ method: z.literal('cod') }),
]);
const checkoutLimit = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many checkout attempts.')),
});
export const commerce = Router();
commerce.get('/products', route(async (req, res) => {
  const { search, category, sort } = z.object({
    search: z.string().trim().max(100).optional(), category: shortText.optional(),
    sort: z.enum(['name', 'price-asc', 'price-desc']).default('name'),
  }).strict().parse(req.query);
  const escaped = search?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = { active: true };
  if (category) match.category = category;
  if (escaped) match.$or = ['name', 'description'].map(field => ({ [field]: new RegExp(escaped, 'i') }));
  const ordering = { name: { name: 1 }, 'price-asc': { price: 1, name: 1 }, 'price-desc': { price: -1, name: 1 } };
  res.json(await Product.find(match).sort(ordering[sort]).limit(200).lean());
}));
commerce.get('/products/:sku', route(async (req, res) => {
  const product = await Product.findOne({ sku: sku.parse(req.params.sku), active: true });
  if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');
  res.json(product);
}));
commerce.get('/cart', requireUser, route(async (req, res) => res.json(await cartView(req.user._id))));
commerce.put('/cart/items/:sku', requireUser, route(async (req, res) => {
  const { quantity } = z.object({ quantity: z.number().int().min(1).max(10) }).strict().parse(req.body);
  res.json(await updateCart(req.user._id, sku.parse(req.params.sku), quantity));
}));
commerce.delete('/cart/items/:sku', requireUser, route(async (req, res) => {
  res.json(await updateCart(req.user._id, sku.parse(req.params.sku), 0));
}));
commerce.post(['/checkout', '/payments/confirm'], requireUser, checkoutLimit, route(async (req, res) => {
  const result = await checkout(req.user._id, checkoutInput.parse(req.body));
  if (result.payment.status === 'Failed') throw new HttpError(402, 'PAYMENT_FAILED', result.payment.failureReason);
  res.status(201).json(result);
}));

async function orderDetail(order) {
  const payment = await Payment.findOne({ order: order._id });
  return { ...order.toObject(), payment: paymentSummary(payment) };
}
commerce.get('/my/orders', requireUser, route(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  res.json(await Promise.all(orders.map(orderDetail)));
}));
commerce.get('/my/orders/:number', requireUser, route(async (req, res) => {
  res.json(await orderDetail(await findOrder(number.parse(req.params.number), req.user._id)));
}));
commerce.post('/my/orders/:number/cancel', requireUser, route(async (req, res) => {
  res.json(await orderDetail(await cancelOrder(number.parse(req.params.number), req.user._id)));
}));
commerce.post('/my/orders/:number/return', requireUser, route(async (req, res) => {
  res.json(await orderDetail(await requestReturn(number.parse(req.params.number), req.user._id)));
}));

const status = z.enum(['PendingPayment', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'PaymentFailed']);
const change = z.discriminatedUnion('status', [
  z.object({ status: z.literal('Processing') }).strict(),
  z.object({ status: z.literal('Shipped'), carrier: shortText, tracking: shortText }).strict(),
  z.object({ status: z.literal('Delivered') }).strict(),
]);
commerce.get('/admin/orders', requireUser, requireAdmin, route(async (req, res) => {
  const query = z.object({ status: status.optional() }).strict().parse(req.query);
  res.json(await Order.find(query).sort({ createdAt: -1 }).limit(200));
}));
commerce.get('/admin/orders/:number', requireUser, requireAdmin, route(async (req, res) => {
  res.json(await orderDetail(await findOrder(number.parse(req.params.number))));
}));
commerce.patch('/admin/orders/:number/status', requireUser, requireAdmin, route(async (req, res) => {
  res.json(await orderDetail(await advanceOrder(number.parse(req.params.number), change.parse(req.body), req.user.id)));
}));
commerce.patch('/admin/orders/:number/return', requireUser, requireAdmin, route(async (req, res) => {
  const { decision } = z.object({ decision: z.enum(['Approved', 'Rejected']) }).strict().parse(req.body);
  res.json(await orderDetail(await resolveReturn(number.parse(req.params.number), decision)));
}));
