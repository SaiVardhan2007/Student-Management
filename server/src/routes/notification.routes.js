import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { Notification } from '../models/index.js';
import { asyncHandler, ok, paginate, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';

const r = Router();
r.use(protect);

r.get('/', asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.unread === 'true') filter.isRead = false;
  const { items, meta } = await paginate(Notification, req, { filter, defaultSort: { createdAt: -1 }, allowedSort: ['createdAt'] });
  ok(res, items, 'OK', 200, { ...meta, unread: await Notification.countDocuments({ user: req.user._id, isRead: false }) });
}));

r.get('/unread-count', asyncHandler(async (req, res) => {
  ok(res, { count: await Notification.countDocuments({ user: req.user._id, isRead: false }) });
}));

r.post('/read-all', asyncHandler(async (req, res) => {
  const out = await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true, readAt: new Date() });
  ok(res, { updated: out.modifiedCount }, 'All notifications marked as read');
}));

r.patch('/:id/read', asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { isRead: true, readAt: new Date() }, { new: true });
  if (!n) throw AppError.notFound('Notification not found');
  ok(res, n);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const n = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!n) throw AppError.notFound('Notification not found');
  ok(res, null, 'Notification deleted');
}));

export default r;
