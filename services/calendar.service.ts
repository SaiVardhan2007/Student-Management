import { CalendarEvent } from '@/models';
import { crud } from '@/services/crud';

const AUDIENCES: Record<string, string[]> = { student: ['all', 'students'], faculty: ['all', 'faculty'], parent: ['all', 'parents'] };

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
    const scoped = AUDIENCES[ctx.user.role] ? { audience: { $in: AUDIENCES[ctx.user.role] } } : {};
    const { from, to } = ctx.query;
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    return { ...scoped, ...(from || to ? { startDate: range } : {}) };
  },
});
