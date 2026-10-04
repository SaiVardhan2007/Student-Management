import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadSingle, toFileMeta, removeFile, removeUploaded } from '../middleware/upload.js';
import { Notice } from '../models/index.js';
import { noticeSchema, noticeUpdateSchema } from '../validators/ops.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { facultyTeachesSection, ownStudents, yearOfSemester } from '../services/scope.js';
import { notifyStudents, notifyUsers } from '../services/notify.js';
import { User, Faculty } from '../models/index.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);
const staff = authorize('admin', 'faculty');
const POPULATE = [
  { path: 'department', select: 'name' },
  { path: 'program', select: 'name' },
  { path: 'section', select: 'name' },
  { path: 'createdBy', select: 'name role' },
];

/** Notices the current user is allowed to see. */
async function visibilityFilter(req) {
  const now = new Date();
  const live = [
    { publishDate: { $lte: now } },
    { $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gt: now } }] },
  ];
  const { role } = req.user;
  if (role === 'admin') return req.query.active === 'true' ? { $and: live } : {};
  if (role === 'faculty') return { $or: [{ createdBy: req.user._id }, { $and: [...live, { audience: { $in: ['all', 'faculty'] } }] }] };
  const students = await ownStudents(req);
  const audience = role === 'parent' ? ['all', 'parents', 'students'] : ['all', 'students'];
  const target = students.map((s) => ({
    $and: ['department', 'program', 'section']
      .map((k) => ({ $or: [{ [k]: { $exists: false } }, { [k]: null }, { [k]: s[k] }] }))
      .concat([{ $or: [{ year: { $exists: false } }, { year: null }, { year: yearOfSemester(s.semester) }] }]),
  }));
  return { $and: [...live, { audience: { $in: audience } }, { $or: target.length ? target : [{ _id: null }] }] };
}

r.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {
      ...filtersFromQuery(req.query, { priority: 'string', department: 'id', program: 'id', section: 'id' }),
      ...(await visibilityFilter(req)),
    };
    const { items, meta } = await paginate(Notice, req, {
      filter,
      searchFields: ['title', 'description'],
      allowedSort: ['publishDate', 'priority', 'title'],
      defaultSort: { publishDate: -1 },
      populate: POPULATE,
    });
    ok(res, items, 'OK', 200, meta);
  })
);

r.get(
  '/:id',
  asyncHandler(async (req, res) => {
    requireValidId(req.params.id);
    const n = await Notice.findOne({ $and: [{ _id: req.params.id }, await visibilityFilter(req)] }).populate(POPULATE);
    if (!n) throw AppError.notFound('Notice not found');
    ok(res, n);
  })
);

async function assertMayPublish(req, body) {
  if (req.user.role === 'admin') return;
  // faculty may only address classes they teach
  if (!body.section) throw AppError.forbidden('Faculty notices must target one of your class sections');
  if (!(await facultyTeachesSection(req, body.section))) throw AppError.forbidden('You do not teach the selected section');
  body.audience = 'students';
}

async function announce(n) {
  const filter = {};
  for (const k of ['department', 'program', 'section']) if (n[k]) filter[k] = n[k];
  if (n.year) filter.semester = { $in: [n.year * 2 - 1, n.year * 2] };
  const payload = { title: `Notice: ${n.title}`, message: n.description.slice(0, 140), type: 'notice', link: '/notices' };
  if (['all', 'students'].includes(n.audience)) await notifyStudents(filter, payload);
  if (['all', 'faculty'].includes(n.audience)) {
    const fac = await Faculty.find({ status: 'active', ...(n.department ? { department: n.department } : {}) })
      .select('user')
      .lean();
    await notifyUsers(
      fac.map((f) => f.user),
      payload
    );
  }
  if (n.audience === 'parents') {
    const parents = await User.find({ role: 'parent', isActive: true }).select('_id').lean();
    await notifyUsers(
      parents.map((p) => p._id),
      payload
    );
  }
}

r.post(
  '/',
  staff,
  uploadSingle('notices', 'attachment'),
  validate(noticeSchema),
  asyncHandler(async (req, res) => {
    try {
      await assertMayPublish(req, req.body);
      const n = await Notice.create({
        ...req.body,
        createdBy: req.user._id,
        attachment: req.file ? toFileMeta(req.file, 'notices') : undefined,
      });
      if (n.publishDate <= new Date()) await announce(n);
      await audit(req, 'NOTICE_CREATED', 'Notice', n._id, { title: n.title });
      created(res, n, 'Notice published');
    } catch (err) {
      removeUploaded(req);
      throw err;
    }
  })
);

async function loadEditable(req) {
  requireValidId(req.params.id);
  const n = await Notice.findById(req.params.id);
  if (!n) throw AppError.notFound('Notice not found');
  if (req.user.role !== 'admin' && String(n.createdBy) !== String(req.user._id))
    throw AppError.forbidden('You can only modify your own notices');
  return n;
}

r.patch(
  '/:id',
  staff,
  uploadSingle('notices', 'attachment'),
  validate(noticeUpdateSchema),
  asyncHandler(async (req, res) => {
    try {
      const n = await loadEditable(req);
      if (req.user.role !== 'admin') await assertMayPublish(req, { section: req.body.section ?? n.section, ...req.body });
      n.set(req.body);
      if (req.user.role === 'faculty') n.audience = 'students';
      if (req.file) {
        removeFile(n.attachment);
        n.attachment = toFileMeta(req.file, 'notices');
      }
      await n.save();
      await audit(req, 'NOTICE_UPDATED', 'Notice', n._id);
      ok(res, n, 'Notice updated');
    } catch (err) {
      removeUploaded(req);
      throw err;
    }
  })
);

r.delete(
  '/:id',
  staff,
  asyncHandler(async (req, res) => {
    const n = await loadEditable(req);
    removeFile(n.attachment);
    await n.deleteOne();
    await audit(req, 'NOTICE_DELETED', 'Notice', n._id);
    ok(res, null, 'Notice deleted');
  })
);

export default r;
