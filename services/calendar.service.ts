// Calendar events service. Each event has an audience, and users only see events meant for their role.
import { CalendarEvent } from '@/models';
import { crud } from '@/services/crud';

const AUDIENCES: Record<string, string[]> = { student: ['all', 'students'], faculty: ['all', 'faculty'], parent: ['all', 'parents', 'students'] };

export const calendar = crud({
  Model: CalendarEvent,
  entity: 'CalendarEvent',
  searchFields: ['title', 'description'],
  filterSpec: { type: 'string' },
  allowedSort: ['startDate', 'title'],
  defaultSort: { startDate: 1 },
  withCreator: 'createdBy',
  // students/faculty/parents only see events addressed to them
  scope: async (ctx) => {
    const filter: Record<string, any> = {};
    const allowedAudiences = AUDIENCES[ctx.user.role];
    if (allowedAudiences) filter.audience = { $in: allowedAudiences };

    // optional date range: from / to are query parameters
    const { from, to } = ctx.query;
    // an event overlaps the range when it starts before `to` and ends (or, if single-day, starts) on/after `from`
    const and: Record<string, any>[] = [];
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) end.setUTCHours(23, 59, 59, 999); // a bare date means the whole day
        and.push({ startDate: { $lte: end } });
      }
    }
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime()))
        and.push({ $or: [{ endDate: { $gte: start } }, { endDate: null, startDate: { $gte: start } }, { endDate: { $exists: false }, startDate: { $gte: start } }] });
    }
    if (and.length) filter.$and = and;
    return filter;
  },
});
