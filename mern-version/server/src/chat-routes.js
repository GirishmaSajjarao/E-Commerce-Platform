import { Router } from 'express';
import { z } from 'zod';
import { requireUser, requireAdmin } from './auth.js';
import { publicMessage, sendMessage } from './chat.js';
import { findOrder } from './commerce.js';
import { Conversation, Message, User } from './models.js';
import { HttpError, route } from './http.js';
import { redactPii } from './guard.js';

const id = z.string().regex(/^[a-f0-9]{24}$/i);
const input = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  orderNumber: z.string().regex(/^ORD-\d{4,12}$/).optional(),
  customerId: z.string().trim().min(1).max(40).optional(),
}).strict();
const view = conversation => ({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt });
export async function getConversation(value, user, admin = false) {
  const conversation = await Conversation.findById(id.parse(value));
  if (!conversation) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
  if (!admin && !conversation.user.equals(user)) throw new HttpError(403, 'FORBIDDEN', 'This conversation belongs to another account.');
  return conversation;
}
export const chat = Router();
chat.use('/chat', requireUser);
chat.get('/chat/conversations', route(async (req, res) => {
  res.json((await Conversation.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(100)).map(view));
}));
chat.post('/chat/conversations', route(async (req, res) => {
  const { title, orderNumber, customerId } = input.parse(req.body);
  let customer = req.user;
  if (customerId) {
    if (req.user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only administrators may test as a customer.');
    customer = await User.findOne({ role: 'customer', customerId });
    if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found.');
  }
  const order = orderNumber ? await findOrder(orderNumber, customer._id) : null;
  const conversation = await Conversation.create({
    user: req.user._id, customer: customer._id, title: title ? redactPii(title) : 'New conversation', order: order?._id,
  });
  res.status(201).json(view(conversation));
}));
chat.get('/chat/conversations/:id/messages', route(async (req, res) => {
  const conversation = await getConversation(req.params.id, req.user._id);
  const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: -1, _id: -1 }).limit(200);
  res.json(messages.reverse().map(publicMessage));
}));
chat.post('/chat/conversations/:id/messages', route(async (req, res) => {
  const { content } = z.object({ content: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
  const conversation = await getConversation(req.params.id, req.user._id);
  const result = await sendMessage(conversation, content);
  const message = publicMessage(result);
  res.json(req.user.role === 'admin' ? { ...message, context: result.context, latencyMs: result.latencyMs, flagged: result.flagged } : message);
}));
chat.get('/admin/chats', requireUser, requireAdmin, route(async (req, res) => {
  res.json(await Conversation.find().select('-pendingAction').populate('customer', 'name customerId').populate('order', 'number').sort({ updatedAt: -1 }).limit(200));
}));
chat.get('/admin/chats/:id', requireUser, requireAdmin, route(async (req, res) => {
  const conversation = await getConversation(req.params.id, req.user._id, true);
  const messages = await Message.find({ conversation: conversation._id }).select('-rawContent').sort({ createdAt: -1, _id: -1 }).limit(200);
  res.json(messages.reverse());
}));
