import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireUser } from './auth.js';
import { Cart, Order, Payment, Product, User } from './models.js';
import { HttpError, route } from './http.js';

export const admin = Router();
admin.use(requireUser, requireAdmin);
admin.get('/customers', route(async (req, res) => {
  res.json(await User.find({ role: 'customer' }).select('customerId name email phone createdAt').sort({ createdAt: -1 }).limit(200));
}));
admin.get('/carts', route(async (req, res) => {
  const carts = await Cart.find({ 'items.0': { $exists: true } })
    .populate('user', 'name customerId').populate('items.product', 'sku name price').sort({ updatedAt: -1 }).limit(200).lean();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  res.json(carts.map(cart => ({ ...cart, state: cart.updatedAt.getTime() < cutoff ? 'Abandoned' : 'Active' })));
}));
admin.get('/payments', route(async (req, res) => {
  res.json(await Payment.find().select('-last4 -brand -idempotencyKey').populate('order', 'number').sort({ createdAt: -1 }).limit(200));
}));
const text = (max) => z.string().trim().min(1).max(max);
const sku = z.string().regex(/^[A-Z0-9-]{1,32}$/);
const product = z.object({
  name: text(150), description: text(1000), category: text(100),
  price: z.number().int().min(0).max(10_000_000), stock: z.number().int().min(0).max(1_000_000), active: z.boolean(),
}).strict();
admin.get('/products', route(async (req, res) => res.json(await Product.find().sort({ name: 1 }).limit(200))));
admin.post('/products', route(async (req, res) => {
  res.status(201).json(await Product.create(product.extend({ sku }).parse(req.body)));
}));
admin.patch('/products/:sku', route(async (req, res) => {
  const updated = await Product.findOneAndUpdate({ sku: sku.parse(req.params.sku) }, { $set: product.partial().parse(req.body) }, { new: true, runValidators: true });
  if (!updated) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');
  res.json(updated);
}));
admin.get('/sales-summary', route(async (req, res) => {
  const [payments, ordersPerDay, topProducts, lowStock] = await Promise.all([
    Payment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Order.aggregate([{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 30 }]),
    Payment.aggregate([
      { $match: { status: 'Paid', order: { $exists: true } } },
      { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'orderRecord' } },
      { $unwind: '$orderRecord' }, { $unwind: '$orderRecord.items' },
      { $group: { _id: '$orderRecord.items.product', name: { $first: '$orderRecord.items.name' }, quantity: { $sum: '$orderRecord.items.quantity' } } },
      { $sort: { quantity: -1, name: 1 } }, { $limit: 10 },
    ]),
    Product.find({ active: true, stock: { $lte: 5 } }).select('sku name stock').sort({ stock: 1, name: 1 }).limit(30).lean(),
  ]);
  const status = Object.fromEntries(payments.map(row => [row._id, row]));
  const paid = status.Paid?.count || 0;
  const successful = paid + (status.Refunded?.count || 0);
  const attempts = successful + (status.Failed?.count || 0);
  res.json({ revenue: status.Paid?.amount || 0, paymentSuccessRate: attempts ? successful / attempts : null,
    ordersPerDay: ordersPerDay.reverse().map(row => ({ date: row._id, count: row.count })), topProducts, lowStock });
}));
