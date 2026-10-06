import type { Ctx } from '@/lib/context';
import { AuditLog } from '@/models';
import { logger } from '@/lib/logger';

const SENSITIVE = /pass|token|secret/i;

function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : scrub(v)]));
}

/** Record an audit entry. Never throws — auditing must not break the request. */
export async function audit(ctx: Partial<Ctx> | undefined, action: string, entity?: string, entityId?: unknown, details?: unknown) {
  try {
    await AuditLog.create({
      user: ctx?.user?._id,
      userName: ctx?.user?.name,
      role: ctx?.user?.role,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      details: scrub(details),
      ip: ctx?.ip,
    });
  } catch (err) {
    logger.error('Failed to write audit log', err);
  }
}
