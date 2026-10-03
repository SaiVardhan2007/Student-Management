import { Router } from 'express';
import { protect, authorize, studentProfile } from '../middleware/auth.js';
import { validate, z, optionalDate } from '../middleware/validate.js';
import { uploadSingle, toFileMeta, removeFile, removeUploaded } from '../middleware/upload.js';
import { Achievement, Student } from '../models/index.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { ownStudentIds, visibleStudentScope } from '../services/access.js';
import { notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.enum(['certification', 'hackathon', 'sports', 'technical', 'cultural', 'other']).default('other'),
  description: z.string().trim().max(2000).optional(),
  date: optionalDate,
});
const verifySchema = z.object({ status: z.enum(['verified', 'rejected']) });
const POPULATE = [{ path: 'student', select: 'studentId firstName lastName' }];

r.get('/', asyncHandler(async (req, res) => {
  const filter = filtersFromQuery(req.query, { status: 'string', category: 'string', student: 'id' });
  if (req.user.role === 'student' || req.user.role === 'parent') filter.student = { $in: await ownStudentIds(req) };
  else if (req.user.role === 'faculty') {
    const scope = await visibleStudentScope(req);
    filter.student = { $in: scope.ids };
  }
  const { items, meta } = await paginate(Achievement, req, { filter, searchFields: ['title'], allowedSort: ['createdAt', 'date', 'status'], populate: POPULATE });
  ok(res, items, 'OK', 200, meta);
}));

r.post('/', authorize('student'), uploadSingle('achievements', 'certificate'), validate(createSchema), asyncHandler(async (req, res) => {
  try {
    const s = await studentProfile(req);
    const a = await Achievement.create({ ...req.body, student: s._id, certificate: req.file ? toFileMeta(req.file, 'achievements') : undefined });
    await audit(req, 'ACHIEVEMENT_ADDED', 'Achievement', a._id);
    created(res, a, 'Achievement added and awaiting verification');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
}));

r.patch('/:id/verify', authorize('admin', 'faculty'), validate(verifySchema), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const a = await Achievement.findById(req.params.id);
  if (!a) throw AppError.notFound('Achievement not found');
  if (req.user.role === 'faculty') {
    const scope = await visibleStudentScope(req);
    if (!scope.ids.some((i) => String(i) === String(a.student))) throw AppError.forbidden('You can only verify achievements of your students');
  }
  a.set({ status: req.body.status, verifiedBy: req.user._id, verifiedAt: new Date() });
  await a.save();
  const s = await Student.findById(a.student).select('user');
  if (s?.user) await notifyUsers([s.user], { title: `Achievement ${a.status}`, message: a.title, type: 'general', link: '/achievements' });
  await audit(req, 'ACHIEVEMENT_' + a.status.toUpperCase(), 'Achievement', a._id);
  ok(res, a, 'Achievement reviewed');
}));

r.delete('/:id', authorize('admin', 'student'), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const a = await Achievement.findById(req.params.id);
  if (!a) throw AppError.notFound('Achievement not found');
  if (req.user.role === 'student' && String(a.student) !== String((await studentProfile(req))._id)) throw AppError.forbidden();
  removeFile(a.certificate);
  await a.deleteOne();
  ok(res, null, 'Achievement deleted');
}));

export default r;
