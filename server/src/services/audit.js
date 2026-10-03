import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

const SENSITIVE = /pass|token|secret/i;

function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : scrub(v)]));
}

/** Record an audit entry. Never throws — auditing must not break the request. */
export async function audit(req, action, entity, entityId, details) {
  try {
    await AuditLog.create({
      user: req?.user?._id,
      userName: req?.user?.name,
      role: req?.user?.role,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      details: scrub(details),
      ip: req?.ip,
    });
  } catch (err) {
    logger.error('Failed to write audit log', err);
  }
}
