import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { Cart, Counter, Order, Payment, Product, Refund } from './models.js';
import { calculateTotals } from './totals.js';
import { config } from './config.js';
import { HttpError } from './http.js';

const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const day = 86_400_000;
export const paymentSummary = payment => payment && ({
  method: payment.method, status: payment.status, brand: payment.brand, last4: payment.last4,
  failureReason: payment.failureReason, amount: payment.amount,
});

export class MockPaymentProvider {
  authorize({ method, card, upi }) {
    if (method === 'cod') return { status: 'Pending' };
    if (method === 'upi') return upi === 'success' ? { status: 'Paid' } : { status: 'Failed', failureReason: 'UPI payment declined.' };
    const details = { brand: 'Visa', last4: card.slice(-4) };
    if (card === ['4242', '4242', '4242', '4242'].join('')) return { ...details, status: 'Paid' };
    const failureReason = {
      [['4000', '0000', '0000', '0002'].join('')]: 'Card declined.',
      [['4000', '0000', '0000', '9995'].join('')]: 'Insufficient funds.',
    }[card] || 'Use a supported test card.';
    return { ...details, status: 'Failed', failureReason };
  }
}

export async function cartView(user) {
  const cart = await Cart.findOne({ user }).populate('items.product');
  const items = (cart?.items || []).filter(item => item.product).map(({ product, quantity }) => ({
    sku: product.sku, name: product.name, unitPrice: product.price, stock: product.stock, active: product.active, quantity,
  }));
  return { items, totals: calculateTotals(items, 'standard', config.TAX_RATE), expressTotals: calculateTotals(items, 'express', config.TAX_RATE) };
}

export async function updateCart(user, sku, quantity) {
  const product = await Product.findOne({ sku });
  if (!product) fail(404, 'NOT_FOUND', 'Product not found.');
  if (quantity && (!product.active || quantity > product.stock)) fail(409, 'OUT_OF_STOCK', 'Requested quantity is unavailable.');
  await Cart.updateOne({ user }, [{
    $set: { items: { $concatArrays: [
      { $filter: { input: { $ifNull: ['$items', []] }, as: 'item', cond: { $ne: ['$$item.product', product._id] } } },
      quantity ? [{ product: product._id, quantity }] : [],
    ] } },
  }], { upsert: true });
  return cartView(user);
}

async function checkoutResult(payment, session) {
  const order = payment.order && await Order.findById(payment.order).session(session ?? null);
  return { order, payment: paymentSummary(payment) };
}

export async function checkout(user, input) {
  const { idempotencyKey, delivery, address, method } = input;
  const identity = { user, idempotencyKey };
  if (config.PAYMENT_PROVIDER !== 'mock' && method !== 'cod') fail(503, 'PAYMENT_UNAVAILABLE', 'Select the mock payment provider for local checkout.');
  try {
    return await mongoose.connection.transaction(async session => {
      const existing = await Payment.findOne(identity).session(session);
      if (existing) return checkoutResult(existing, session);
      const cart = await Cart.findOne({ user }).session(session);
      if (!cart?.items.length) fail(400, 'EMPTY_CART', 'Your cart is empty.');
      const items = [];
      for (const { product, quantity } of cart.items) {
        const record = await Product.findOne({ _id: product, active: true, stock: { $gte: quantity } }).session(session);
        if (!record) fail(409, 'OUT_OF_STOCK', 'An item is no longer available in the requested quantity.');
        items.push({ product, name: record.name, quantity, unitPrice: record.price });
      }
      const totals = calculateTotals(items, delivery, config.TAX_RATE);
      const outcome = new MockPaymentProvider().authorize(input);
      const paymentFields = { ...identity, ...outcome, amount: totals.total, method, provider: 'mock', transactionId: randomUUID() };
      if (outcome.status === 'Failed') {
        const [payment] = await Payment.create([paymentFields], { session });
        return checkoutResult(payment, session);
      }
      for (const { product, quantity } of items) {
        const changed = await Product.updateOne({ _id: product, active: true, stock: { $gte: quantity } }, { $inc: { stock: -quantity } }, { session });
        if (!changed.modifiedCount) fail(409, 'OUT_OF_STOCK', 'An item sold out during checkout.');
      }
      const counter = await Counter.findOneAndUpdate({ _id: 'order' }, { $inc: { value: 1 } }, { new: true, session, upsert: true });
      const now = Date.now();
      const status = outcome.status === 'Paid' ? 'Processing' : 'PendingPayment';
      const [order] = await Order.create([{
        number: `ORD-${String(counter.value).padStart(4, '0')}`, user, items, ...totals, address, status, delivery,
        deliveryEstimate: { from: new Date(now + day * (delivery === 'express' ? 1 : 3)), to: new Date(now + day * (delivery === 'express' ? 2 : 5)) },
        statusHistory: [{ status, at: now, actor: String(user) }],
      }], { session });
      const [payment] = await Payment.create([{ ...paymentFields, order: order._id }], { session });
      cart.items = [];
      await cart.save({ session });
      return { order, payment: paymentSummary(payment) };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await Payment.findOne(identity);
    if (!existing) throw error;
    return checkoutResult(existing);
  }
}

export async function findOrder(number, user, session) {
  const order = await Order.findOne({ number }).session(session ?? null);
  if (!order) fail(404, 'NOT_FOUND', 'Order not found.');
  if (user && !order.user.equals(user)) fail(403, 'FORBIDDEN', 'You can only access your own orders.');
  return order;
}

async function refund(order, reason, session) {
  const payment = await Payment.findOne({ order: order._id }).session(session);
  if (payment?.status !== 'Paid') return;
  await Refund.create([{ order: order._id, payment: payment._id, amount: payment.amount, reason }], { session });
  payment.status = 'Refunded';
  await payment.save({ session });
}

export function cancelOrder(number, user) {
  return mongoose.connection.transaction(async session => {
    const order = await findOrder(number, user, session);
    if (order.status === 'Cancelled') return order;
    if (!['PendingPayment', 'Processing'].includes(order.status)) fail(409, 'INVALID_TRANSITION', 'Only orders that have not shipped can be cancelled.');
    for (const item of order.items) await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }, { session });
    await refund(order, 'Order cancelled', session);
    order.status = 'Cancelled';
    order.statusHistory.push({ status: 'Cancelled', at: new Date(), actor: String(user) });
    return order.save({ session });
  });
}

export async function requestReturn(number, user) {
  const order = await findOrder(number, user);
  const updated = await Order.findOneAndUpdate({
    _id: order._id, status: 'Delivered', returnStatus: 'None', deliveredAt: { $gte: new Date(Date.now() - 30 * day), $lte: new Date() },
  }, { $set: { returnStatus: 'Requested' } }, { new: true });
  if (!updated) fail(409, 'RETURN_UNAVAILABLE', 'Returns can be requested within 30 days of delivery.');
  return updated;
}

export function resolveReturn(number, decision) {
  return mongoose.connection.transaction(async session => {
    const order = await findOrder(number, null, session);
    if (order.returnStatus !== 'Requested') fail(409, 'RETURN_UNAVAILABLE', 'This order does not have a pending return request.');
    if (decision === 'Approved') await refund(order, 'Return approved', session);
    order.returnStatus = decision;
    return order.save({ session });
  });
}

const transitions = { PendingPayment: 'Processing', Processing: 'Shipped', Shipped: 'Delivered' };
export function advanceOrder(number, { status, carrier, tracking }, actor) {
  return mongoose.connection.transaction(async session => {
    const order = await findOrder(number, null, session);
    if (transitions[order.status] !== status) fail(409, 'INVALID_TRANSITION', 'This status change is unavailable.');
    order.status = status;
    if (status === 'Shipped') { order.carrier = carrier; order.tracking = tracking; }
    if (status === 'Delivered') {
      order.deliveredAt = new Date();
      await Payment.updateOne({ order: order._id, method: 'cod', status: 'Pending' }, { $set: { status: 'Paid' } }, { session });
    }
    order.statusHistory.push({ status, at: new Date(), actor: String(actor) });
    return order.save({ session });
  });
}
