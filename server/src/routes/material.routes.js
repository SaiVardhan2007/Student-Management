import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadSingle, toFileMeta, removeFile, removeUploaded } from '../middleware/upload.js';
import { Material } from '../models/index.js';
import { materialSchema } from '../validators/ops.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { assertSubjectAccess } from '../services/access.js';
import { visibleSubjectIds } from '../services/scope.js';
import { notifyStudents } from '../services/notify.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);
const staff = authorize('admin', 'faculty');
const POPULATE = [{ path: 'subject', select: 'code name' }, { path: 'uploadedBy', select: 'name' }];

r.get('/', asyncHandler(async (req, res) => {
  const filter = filtersFromQuery(req.query, { subject: 'id', type: 'string' });
  const visible = await visibleSubjectIds(req);
  if (visible) filter.subject = filter.subject ? (visible.some((s) => String(s) === String(filter.subject)) ? filter.subject : null) : { $in: visible };
  const { items, meta } = await paginate(Material, req, { filter, searchFields: ['title', 'description'], allowedSort: ['createdAt', 'title'], populate: POPULATE });
  ok(res, items, 'OK', 200, meta);
}));

r.post('/', staff, uploadSingle('materials', 'file'), validate(materialSchema), asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw AppError.badRequest('Please choose a file to upload');
    const subject = await assertSubjectAccess(req, req.body.subject);
    const m = await Material.create({ ...req.body, file: toFileMeta(req.file, 'materials'), uploadedBy: req.user._id });
    await notifyStudents({ program: subject.program, semester: subject.semester }, { title: `New study material: ${m.title}`, message: `${subject.code} - ${subject.name}`, type: 'general', link: '/materials' });
    await audit(req, 'MATERIAL_UPLOADED', 'Material', m._id, { subject: subject.code });
    created(res, m, 'Material uploaded');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
}));

r.delete('/:id', staff, asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const m = await Material.findById(req.params.id);
  if (!m) throw AppError.notFound('Material not found');
  await assertSubjectAccess(req, m.subject);
  removeFile(m.file);
  await m.deleteOne();
  await audit(req, 'MATERIAL_DELETED', 'Material', m._id);
  ok(res, null, 'Material deleted');
}));

export default r;
