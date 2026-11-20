import { Cart, Conversation, Faq, Message, Order, Payment, Product } from './models.js';
import { cancelOrder, findOrder, requestReturn } from './commerce.js';
import { CANARY, provider, refusal } from './providers.js';
import { redactCard, redactPii } from './guard.js';
import { HttpError } from './http.js';

const stop = new Set('a an the is are was were be to of for on in at and or my me i you your do does can could would will what when where how it this that with about please tell any have has there their our us we'.split(' '));
const tokens = value => new Set((value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => !stop.has(word)).map(word => word.length > 3 && !word.endsWith('ss') ? word.replace(/s$/, '') : word));
const overlap = (left, right) => [...left].filter(word => right.has(word)).length;
const numbers = value => [...new Set((value.match(/\bORD-\d{4,12}\b/gi) || []).map(id => id.toUpperCase()))];
const usd = value => '$' + (value / 100).toFixed(2);
const iso = value => value?.toISOString().slice(0, 10);
const lastFour = /\b(?:last|final)\s*(?:four|4)\b/i;

function describeOrder(order, payment, message) {
  const items = order.items.map(item => `${item.quantity} x ${item.name}`).join(', ');
  const details = [`Order ${order.number}: ${items}; status: ${order.status}`,
    `payment status: ${payment?.status || 'unavailable'}`, `return status: ${order.returnStatus}`];
  if (order.deliveredAt) details.push('delivery date: ' + iso(order.deliveredAt));
  else if (order.deliveryEstimate?.to) details.push('estimated delivery date: ' + iso(order.deliveryEstimate.to));
  details.push(order.tracking ? `carrier: ${order.carrier}; tracking number: ${order.tracking}` : 'tracking number: not available yet');
  if (payment?.last4 && lastFour.test(message)) details.push('card ending in ' + payment.last4);
  return details.join('; ');
}

export async function retrieve(message, customer, history = '', selectedOrder) {
  const explicit = numbers(message);
  const q = tokens(message);
  const orderTopic = /\b(order|orders|track|tracking|package|shipment)\b/i.test(message) ||
    Boolean((selectedOrder || /\bmy\b/i.test(message)) && /\b(payment|refund|return|delivery)\b/i.test(message));
  const previous = numbers(history);
  let orders = [];
  if (explicit.length) {
    if (!customer) return { denied: true, context: [] };
    orders = await Order.find({ number: { $in: explicit }, user: customer }).limit(15);
    if (orders.length !== explicit.length) {
      const other = await Order.exists({ number: { $in: explicit }, user: { $ne: customer } });
      if (other) return { denied: true, context: [] };
    }
  } else if (customer && orderTopic) {
    const filter = selectedOrder ? { _id: selectedOrder } : previous.length ? { number: { $in: previous } } : {};
    orders = await Order.find({ user: customer, ...filter }).sort({ createdAt: -1 }).limit(5);
  }
  const [payments, products, faqs, cart] = await Promise.all([
    Payment.find({ order: { $in: orders.map(order => order._id) } }),
    Product.find({ active: true }).lean(),
    Faq.find().lean(),
    customer && /\bcart\b/i.test(message) ? Cart.findOne({ user: customer }).populate('items.product', 'name price') : null,
  ]);
  const context = orders.map(order => describeOrder(order, payments.find(payment => payment.order.equals(order._id)), message));
  for (const number of explicit) if (!orders.some(order => order.number === number)) context.push(`No order with ID ${number} exists in our system.`);
  if (/\bcart\b/i.test(message)) context.push(cart?.items.length ? 'Cart: ' + cart.items.filter(item => item.product).map(item => `${item.quantity} x ${item.product.name} at ${usd(item.product.price)}`).join(', ') : 'Your cart is empty.');
  const requested = message.match(/^do you (?:sell|carry|stock|have) (.+?)(?:[.?!]+)?$/i)?.[1];
  const requestedTokens = requested ? tokens(requested.replace(/\b(?:in stock|available)\b/gi, '')) : null;
  const productFacts = products.map(p => {
    const name = tokens(p.name);
    const nameMatch = overlap(q, name);
    const explicitMatch = message.toUpperCase().includes(p.sku);
    if (requestedTokens?.size && !explicitMatch && overlap(requestedTokens, name) !== requestedTokens.size) return { p, score: 0 };
    return { p, score: nameMatch * 3 + (nameMatch ? overlap(q, tokens(p.description + ' ' + p.category)) : 0) + (explicitMatch ? 10 : 0) };
  }).filter(row => row.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3);
  for (const { p } of productFacts) context.push(`Product ${p.sku}: ${p.name}; category: ${p.category}; price: ${usd(p.price)}; availability: ${p.stock ? `in stock (${p.stock} units available)` : 'out of stock'}; description: ${p.description}`);
  const matchedFaq = faqs.map(faq => ({ faq, score: overlap(q, tokens(faq.topic)) * 2 + overlap(q, tokens(faq.text)) }))
    .filter(row => row.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { faq } of matchedFaq) context.push(`${faq.topic}: ${faq.text}`);
  if (!context.length && history) return retrieve(history, customer, '', selectedOrder);
  return { denied: false, context: context.map(redactPii) };
}

export async function answerQuestion(message, customer, history = [], selectedOrder, llm = provider()) {
  const start = performance.now();
  const { denied, context } = await retrieve(message, customer, history.filter(item => item.role === 'user').map(item => item.content).join(' ').slice(-400), selectedOrder);
  const raw = denied ? "I can't share details about orders that don't belong to your account." :
    await llm.generate({ message: redactCard(message), context, history: history.map(item => ({ role: item.role, content: redactPii(item.content) })) });
  const safe = raw.toLowerCase().includes(CANARY.toLowerCase()) ? refusal : redactPii(raw);
  const prefix = llm.isMock ? '[MOCK RESPONSE] ' : '';
  return { role: 'assistant', content: prefix + safe, rawContent: prefix + redactCard(raw), context, latencyMs: Math.round(performance.now() - start), isMock: llm.isMock, flagged: safe !== raw, raw };
}

export function publicMessage({ id, role, content, isMock, createdAt }) {
  return { id, role, content, isMock, createdAt };
}
async function act(conversation, message) {
  const pending = conversation.pendingAction;
  const cancel = /^\s*cancel (?:order )?(ORD-\d{4,12})\s*[.!]?$/i.exec(message);
  const request = /^\s*request (?:a )?return (?:for )?(?:order )?(ORD-\d{4,12})\s*[.!]?$/i.exec(message);
  if (pending) {
    const claimed = await Conversation.findOneAndUpdate({ _id: conversation._id, 'pendingAction.nonce': pending.nonce }, { $unset: { pendingAction: 1 } });
    if (/^\s*(yes|confirm|yes,? confirm)[.!]?\s*$/i.test(message)) {
      if (!claimed) return "I can't confirm this action because it is no longer pending.";
      if (pending.action === 'cancel') await cancelOrder(pending.number, conversation.customer);
      else await requestReturn(pending.number, conversation.customer);
      return pending.action === 'cancel' ? `Order ${pending.number} was cancelled.` : `A return was requested for ${pending.number}.`;
    }
    if (/^\s*(no|stop)[.!]?\s*$/i.test(message)) return 'The requested action was discarded.';
  }
  if (!cancel && !request) return null;
  const number = (cancel || request)[1].toUpperCase();
  const order = await findOrder(number, conversation.customer);
  if (cancel && !['Processing', 'PendingPayment'].includes(order.status)) return "I can't cancel an order after shipping, payment failure, or cancellation.";
  const action = cancel ? 'cancel' : 'return';
  await Conversation.updateOne({ _id: conversation._id }, { $set: { pendingAction: { action, number, nonce: crypto.randomUUID() } } });
  return `Reply “confirm” to ${cancel ? 'cancel' : 'request a return for'} ${number}, or “no” to discard.`;
}

export async function sendMessage(conversation, message) {
  const previous = (await Message.find({ conversation: conversation._id }).sort({ createdAt: -1, _id: -1 }).limit(10)).reverse();
  await Message.create({ conversation: conversation._id, role: 'user', content: redactCard(message) });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { title: conversation.title === 'New conversation' ? redactPii(message).slice(0, 60) : conversation.title } });
  const llm = provider();
  let content;
  try { content = await act(conversation, message); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) throw error;
    content = error.status === 403 ? "I can't access orders that belong to another customer." : "I can't complete that action. " + error.message;
  }
  if (content && llm.isMock) content = '[MOCK RESPONSE] ' + content;
  const { raw, ...answer } = content ? { role: 'assistant', content, rawContent: content, context: [], latencyMs: 0, isMock: llm.isMock }
    : await answerQuestion(message, conversation.customer, previous, conversation.order, llm);
  return Message.create({ ...answer, conversation: conversation._id });
}
