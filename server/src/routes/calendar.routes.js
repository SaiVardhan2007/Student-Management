import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { crud } from '../controllers/crud.js';
import { CalendarEvent } from '../models/index.js';
import { calendarSchema } from '../validators/ops.js';

const r = Router();
r.use(protect);

const ctl = crud({
  Model: CalendarEvent,
  entity: 'CalendarEvent',
  searchFields: ['title', 'description'],
  filterSpec: { type: 'string' },
  allowedSort: ['startDate', 'title'],
  defaultSort: { startDate: 1 },
  withCreator: 'createdBy',
  // students/faculty/parents only see events addressed to them
  scope: async (req) => {
    const map = { student: ['all', 'students'], faculty: ['all', 'faculty'], parent: ['all', 'parents'] };
    const scoped = map[req.user.role] ? { audience: { $in: map[req.user.role] } } : {};
    const { from, to } = req.query;
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    return { ...scoped, ...(from || to ? { startDate: range } : {}) };
  },
});

const partial = calendarSchema._def.schema.partial();
r.get('/', ctl.list);
r.get('/:id', ctl.get);
r.post('/', authorize('admin'), validate(calendarSchema), ctl.create);
r.patch('/:id', authorize('admin'), validate(partial), ctl.update);
r.delete('/:id', authorize('admin'), ctl.remove);

export default r;
