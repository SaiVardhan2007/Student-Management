import { Router } from 'express';
import { protect, authorize, studentProfile } from '../middleware/auth.js';
import { validate, z } from '../middleware/validate.js';
import { uploadSingle, toFileMeta, removeFile, removeUploaded } from '../middleware/upload.js';
import { StudentDocument, Student } from '../models/index.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { ownStudentIds } from '../services/access.js';
import { notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);

const uploadSchema = z.object({ type: z.enum(['certificate', 'marksheet', 'id_proof', 'internship', 'other']).default('other'), title: z.string().trim().min(1).max(150) });
const reviewSchema = z.object({ status: z.enum(['verified', 'rejected', 'reupload_requested']), reviewNote: z.string().trim().max(500).optional() })
  .refine((d) => d.status === 'verified' || d.reviewNote, { message: 'Please add a note explaining the decision', path: ['reviewNote'] });
const POPULATE = [{ path: 'student', select: 'studentId firstName lastName' }, { path: 'reviewedBy', select: 'name' }];

r.get('/', authorize('admin', 'student', 'parent'), asyncHandler(async (req, res) => {
  const filter = filtersFromQuery(req.query, { status: 'string', type: 'string', student: 'id' });
  if (req.user.role !== 'admin') {
    const ids = await ownStudentIds(req);
    filter.student = filter.student && ids.some((i) => String(i) === String(filter.student)) ? filter.student : { $in: ids };
  }
  const { items, meta } = await paginate(StudentDocument, req, { filter, searchFields: ['title'], allowedSort: ['createdAt', 'status', 'title'], populate: POPULATE });
  ok(res, items, 'OK', 200, meta);
}));

r.post('/', authorize('student'), uploadSingle('documents', 'file'), validate(uploadSchema), asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw AppError.badRequest('Please choose a file to upload');
    const s = await studentProfile(req);
    const d = await StudentDocument.create({ ...req.body, student: s._id, file: toFileMeta(req.file, 'documents') });
    await audit(req, 'DOCUMENT_UPLOADED', 'StudentDocument', d._id, { type: d.type });
    created(res, d, 'Document uploaded and awaiting verification');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
}));

r.patch('/:id/review', authorize('admin'), validate(reviewSchema), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const d = await StudentDocument.findById(req.params.id);
  if (!d) throw AppError.notFound('Document not found');
  d.set({ status: req.body.status, reviewNote: req.body.reviewNote, reviewedBy: req.user._id, reviewedAt: new Date() });
  await d.save();
  const s = await Student.findById(d.student).select('user');
  if (s?.user) await notifyUsers([s.user], { title: `Document ${req.body.status.replace('_', ' ')}`, message: `"${d.title}": ${req.body.reviewNote || 'Your document has been verified.'}`, type: 'document', link: '/documents' });
  await audit(req, `DOCUMENT_${req.body.status.toUpperCase()}`, 'StudentDocument', d._id);
  ok(res, d, 'Document reviewed');
}));

r.delete('/:id', authorize('admin', 'student'), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const d = await StudentDocument.findById(req.params.id);
  if (!d) throw AppError.notFound('Document not found');
  if (req.user.role === 'student') {
    const s = await studentProfile(req);
    if (String(d.student) !== String(s._id)) throw AppError.forbidden();
    if (d.status === 'verified') throw AppError.conflict('Verified documents cannot be deleted');
  }
  removeFile(d.file);
  await d.deleteOne();
  await audit(req, 'DOCUMENT_DELETED', 'StudentDocument', d._id);
  ok(res, null, 'Document deleted');
}));

export default r;
