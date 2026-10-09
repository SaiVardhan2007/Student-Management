// Writes entries to the audit log (who did what). Services call audit() after important actions.
import type { Ctx } from '@/lib/context';
import { AuditLog } from '@/models';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { after } from 'next/server';

// Any field whose name matches this is hidden before it is saved in the log.
const SENSITIVE = /pass|token|secret/i;

function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : scrub(v)]));
}

/**
 * Record an audit entry. Never throws — auditing must not break the request.
 * Inside an API request the write runs after the response is sent (Next's after()), so it does not slow the request;
 * elsewhere (scripts, tests) it is written straight away.
 */
export async function audit(ctx: Partial<Ctx> | undefined, action: string, entity?: string, entityId?: unknown, details?: unknown) {
  const entry = {
    user: ctx?.user?._id,
    userName: ctx?.user?.name,
    role: ctx?.user?.role,
    action,
    entity,
    entityId: entityId ? String(entityId) : undefined,
    details: scrub(details),
    ip: ctx?.ip,
  };
  const write = async () => {
    try {
      await AuditLog.create(entry);
    } catch (err) {
      logger.error('Failed to write audit log', err);
    }
  };
  if (!env.isTest) {
    try {
      after(write);
      return;
    } catch {
      // not inside a request: write it now
    }
  }
  await write();
}
