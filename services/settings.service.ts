import { AuditLog, getSettings } from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { paginate, filtersFromQuery } from '@/lib/query';
import { toFileMeta, removeFile } from '@/lib/upload';
import type { Ctx } from '@/lib/context';
import { audit } from '@/services/audit';

// Branding only — used on the login page before authentication.
export async function publicSettings() {
  const s = await getSettings();
  return ok({ collegeName: s.collegeName, logo: s.logo });
}

export async function get() {
  return ok(await getSettings());
}

export async function update(ctx: Ctx) {
  const s = await getSettings();
  s.set(ctx.body);
  await s.save();
  await audit(ctx, 'SETTINGS_UPDATED', 'Settings', s._id, { fields: Object.keys(ctx.body) });
  return ok(s, 'Settings saved');
}

export async function uploadLogo(ctx: Ctx) {
  if (!ctx.file) throw AppError.badRequest('Please choose an image file');
  const s = await getSettings();
  removeFile(s.logo);
  s.logo = toFileMeta(ctx.file, 'photos')!.path;
  await s.save();
  await audit(ctx, 'SETTINGS_LOGO_UPDATED', 'Settings', s._id);
  return ok({ logo: s.logo }, 'Logo updated');
}

// ---- audit logs (admin only)
export async function listAuditLogs(ctx: Ctx) {
  const filter: Record<string, any> = filtersFromQuery(ctx.query, { user: 'id', action: 'string', entity: 'string', role: 'string' });
  const { from, to } = ctx.query;
  if (from || to)
    filter.timestamp = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(new Date(to).getTime() + 86400000 - 1) }) };
  const { items, meta } = await paginate(AuditLog, ctx, {
    filter,
    searchFields: ['userName', 'action', 'entity', 'entityId'],
    allowedSort: ['timestamp', 'action'],
    defaultSort: { timestamp: -1 },
  });
  return ok(items, 'OK', 200, meta);
}

export async function auditActions() {
  return ok((await AuditLog.distinct('action')).sort());
}
