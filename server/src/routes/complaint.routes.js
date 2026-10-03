import { Router } from 'express';
import { protect, authorize, studentProfile } from '../middleware/auth.js';
import { validate, z, objectId } from '../middleware/validate.js';
import { uploadSingle, toFileMeta, removeUploaded } from '../middleware/upload.js';
import { Complaint, Student, User, COMPLAINT_STATUSES } from '../models/index.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { ownStudentIds } from '../services/access.js';
import { notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);

const createSchema = z.object({
  category: z.enum(['academic', 'administrative', 'hostel', 'library', 'fees', 'infrastructure', 'other']).default('other'),
  subject: z.string().trim().min(3, 'Subject is too short').max(200),
  description: z.string().trim().min(10, 'Please describe the issue (min 10 characters)').max(5000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});
const respondSchema = z.object({ message: z.string().trim().min(1).max(2000) });
const updateSchema = z.object({ status: z.enum(COMPLAINT_STATUSES).optional(), assignedTo: objectId.optional() });
const POPULATE = [{ path: 'student', select: 'studentId firstName lastName' }, { path: 'assignedTo', select: 'name role' }];

async function scope(req) {
  if (req.user.role === 'admin') return {};
  if (req.user.role === 'faculty') return { assignedTo: req.user._id };
  return { student: { $in: await ownStudentIds(req) } };
}

r.get('/', asyncHandler(async (req, res) => {
  const filter = { ...filtersFromQuery(req.query, { status: 'string', category: 'string', priority: 'string' }), ...(await scope(req)) };
  const { items, meta } = await paginate(Complaint, req, { filter, searchFields: ['subject', 'description'], allowedSort: ['createdAt', 'priority', 'status'], populate: POPULATE });
  ok(res, items, 'OK', 200, meta);
}));

r.get('/:id', asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const c = await Complaint.findOne({ _id: req.params.id, ...(await scope(req)) }).populate(POPULATE);
  if (!c) throw AppError.notFound('Ticket not found');
  ok(res, c);
}));

r.post('/', authorize('student'), uploadSingle('complaints', 'attachment'), validate(createSchema), asyncHandler(async (req, res) => {
  try {
    const s = await studentProfile(req);
    const c = await Complaint.create({ ...req.body, student: s._id, attachment: req.file ? toFileMeta(req.file, 'complaints') : undefined });
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
    await notifyUsers(admins.map((a) => a._id), { title: 'New support ticket', message: c.subject, type: 'complaint', link: '/complaints' });
    await audit(req, 'COMPLAINT_CREATED', 'Complaint', c._id);
    created(res, c, 'Ticket submitted');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
}));

r.post('/:id/respond', validate(respondSchema), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const c = await Complaint.findOne({ _id: req.params.id, ...(await scope(req)) });
  if (!c) throw AppError.notFound('Ticket not found');
  if (['resolved', 'closed'].includes(c.status) && req.user.role === 'student') throw AppError.conflict('This ticket is closed');
  if (req.user.role === 'parent') throw AppError.forbidden();
  c.responses.push({ by: req.user._id, byName: req.user.name, message: req.body.message });
  if (req.user.role !== 'student' && ['open', 'assigned'].includes(c.status)) c.status = 'in_progress';
  await c.save();
  const target = req.user.role === 'student' ? c.assignedTo && [c.assignedTo] : [(await Student.findById(c.student).select('user'))?.user];
  if (target) await notifyUsers(target, { title: 'New reply on support ticket', message: `${c.subject}`, type: 'complaint', link: '/complaints' });
  ok(res, c, 'Reply added');
}));

r.patch('/:id', authorize('admin', 'faculty', 'student'), validate(updateSchema), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const c = await Complaint.findOne({ _id: req.params.id, ...(await scope(req)) });
  if (!c) throw AppError.notFound('Ticket not found');
  const { status, assignedTo } = req.body;
  if (req.user.role === 'student') {
    // students may only close their own ticket
    if (assignedTo || status !== 'closed') throw AppError.forbidden('Students can only close their own tickets');
  }
  if (assignedTo) {
    if (req.user.role !== 'admin') throw AppError.forbidden('Only admins can assign tickets');
    const u = await User.findOne({ _id: assignedTo, role: { $in: ['admin', 'faculty'] }, isActive: true });
    if (!u) throw AppError.badRequest('Assignee must be an active admin or faculty user');
    c.assignedTo = u._id;
    if (c.status === 'open' && !status) c.status = 'assigned';
    await notifyUsers([u._id], { title: 'Support ticket assigned to you', message: c.subject, type: 'complaint', link: '/complaints' });
  }
  if (status) c.status = status;
  await c.save();
  if (status && req.user.role !== 'student') {
    const s = await Student.findById(c.student).select('user');
    if (s?.user) await notifyUsers([s.user], { title: `Ticket ${status.replace('_', ' ')}`, message: c.subject, type: 'complaint', link: '/complaints' });
  }
  await audit(req, 'COMPLAINT_UPDATED', 'Complaint', c._id, { status: c.status });
  ok(res, c, 'Ticket updated');
}));

export default r;
