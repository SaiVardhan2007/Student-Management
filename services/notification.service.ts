import { Notification } from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { paginate, requireValidId } from '@/lib/query';
import type { Ctx } from '@/lib/context';

export async function list(ctx: Ctx) {
  const filter: Record<string, any> = { user: ctx.user._id };
  if (ctx.query.unread === 'true') filter.isRead = false;
  const { items, meta } = await paginate(Notification, ctx, { filter, defaultSort: { createdAt: -1 }, allowedSort: ['createdAt'] });
  return ok(items, 'OK', 200, { ...meta, unread: await Notification.countDocuments({ user: ctx.user._id, isRead: false }) });
}

export async function unreadCount(ctx: Ctx) {
  return ok({ count: await Notification.countDocuments({ user: ctx.user._id, isRead: false }) });
}

export async function readAll(ctx: Ctx) {
  const out = await Notification.updateMany({ user: ctx.user._id, isRead: false }, { isRead: true, readAt: new Date() });
  return ok({ updated: out.modifiedCount }, 'All notifications marked as read');
}

export async function markRead(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const n = await Notification.findOneAndUpdate({ _id: ctx.params.id, user: ctx.user._id }, { isRead: true, readAt: new Date() }, { new: true });
  if (!n) throw AppError.notFound('Notification not found');
  return ok(n);
}

export async function remove(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const n = await Notification.findOneAndDelete({ _id: ctx.params.id, user: ctx.user._id });
  if (!n) throw AppError.notFound('Notification not found');
  return ok(null, 'Notification deleted');
}
