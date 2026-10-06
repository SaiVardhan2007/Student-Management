import { Notice, User, Faculty } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { toFileMeta, removeFile } from '@/lib/upload';
import type { Ctx } from '@/lib/context';
import { facultyTeachesSection, ownStudents, yearOfSemester } from '@/services/scope';
import { notifyStudents, notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';

const POPULATE = [
  { path: 'department', select: 'name' },
  { path: 'program', select: 'name' },
  { path: 'section', select: 'name' },
  { path: 'createdBy', select: 'name role' },
];

/** Notices the current user is allowed to see. */
async function visibilityFilter(ctx: Ctx) {
  const now = new Date();
  const live = [
    { publishDate: { $lte: now } },
    { $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gt: now } }] },
  ];
  const { role } = ctx.user;
  if (role === 'admin') return ctx.query.active === 'true' ? { $and: live } : {};
  if (role === 'faculty') return { $or: [{ createdBy: ctx.user._id }, { $and: [...live, { audience: { $in: ['all', 'faculty'] } }] }] };
  const students = await ownStudents(ctx);
  const audience = role === 'parent' ? ['all', 'parents', 'students'] : ['all', 'students'];
  const target = students.map((s: any) => ({
    $and: ['department', 'program', 'section']
      .map((k) => ({ $or: [{ [k]: { $exists: false } }, { [k]: null }, { [k]: s[k] }] }))
      .concat([{ $or: [{ year: { $exists: false } }, { year: null }, { year: yearOfSemester(s.semester) }] }] as any),
  }));
  return { $and: [...live, { audience: { $in: audience } }, { $or: target.length ? target : [{ _id: null }] }] };
}

export async function list(ctx: Ctx) {
  const filter = {
    ...filtersFromQuery(ctx.query, { priority: 'string', department: 'id', program: 'id', section: 'id' }),
    ...(await visibilityFilter(ctx)),
  };
  const { items, meta } = await paginate(Notice, ctx, {
    filter,
    searchFields: ['title', 'description'],
    allowedSort: ['publishDate', 'priority', 'title'],
    defaultSort: { publishDate: -1 },
    populate: POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function get(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const n = await Notice.findOne({ $and: [{ _id: ctx.params.id }, await visibilityFilter(ctx)] }).populate(POPULATE);
  if (!n) throw AppError.notFound('Notice not found');
  return ok(n);
}

async function assertMayPublish(ctx: Ctx, body: Record<string, any>) {
  if (ctx.user.role === 'admin') return;
  // faculty may only address classes they teach
  if (!body.section) throw AppError.forbidden('Faculty notices must target one of your class sections');
  if (!(await facultyTeachesSection(ctx, body.section))) throw AppError.forbidden('You do not teach the selected section');
  body.audience = 'students';
}

async function announce(n: any) {
  const filter: Record<string, any> = {};
  for (const k of ['department', 'program', 'section']) if (n[k]) filter[k] = n[k];
  if (n.year) filter.semester = { $in: [n.year * 2 - 1, n.year * 2] };
  const payload = { title: `Notice: ${n.title}`, message: n.description.slice(0, 140), type: 'notice', link: '/notices' };
  if (['all', 'students'].includes(n.audience)) await notifyStudents(filter, payload);
  if (['all', 'faculty'].includes(n.audience)) {
    const fac = await Faculty.find({ status: 'active', ...(n.department ? { department: n.department } : {}) })
      .select('user')
      .lean();
    await notifyUsers(
      fac.map((f: any) => f.user),
      payload
    );
  }
  if (n.audience === 'parents') {
    const parents = await User.find({ role: 'parent', isActive: true }).select('_id').lean();
    await notifyUsers(
      parents.map((p: any) => p._id),
      payload
    );
  }
}

export async function create(ctx: Ctx) {
  await assertMayPublish(ctx, ctx.body);
  const n = await Notice.create({
    ...ctx.body,
    createdBy: ctx.user._id,
    attachment: ctx.file ? toFileMeta(ctx.file, 'notices') : undefined,
  });
  if (n.publishDate <= new Date()) await announce(n);
  await audit(ctx, 'NOTICE_CREATED', 'Notice', n._id, { title: n.title });
  return created(n, 'Notice published');
}

async function loadEditable(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const n = await Notice.findById(ctx.params.id);
  if (!n) throw AppError.notFound('Notice not found');
  if (ctx.user.role !== 'admin' && String(n.createdBy) !== String(ctx.user._id))
    throw AppError.forbidden('You can only modify your own notices');
  return n;
}

export async function update(ctx: Ctx) {
  const n = await loadEditable(ctx);
  if (ctx.user.role !== 'admin') await assertMayPublish(ctx, { section: ctx.body.section ?? n.section, ...ctx.body });
  n.set(ctx.body);
  if (ctx.user.role === 'faculty') n.audience = 'students';
  if (ctx.file) {
    removeFile(n.attachment);
    n.attachment = toFileMeta(ctx.file, 'notices');
  }
  await n.save();
  await audit(ctx, 'NOTICE_UPDATED', 'Notice', n._id);
  return ok(n, 'Notice updated');
}

export async function remove(ctx: Ctx) {
  const n = await loadEditable(ctx);
  removeFile(n.attachment);
  await n.deleteOne();
  await audit(ctx, 'NOTICE_DELETED', 'Notice', n._id);
  return ok(null, 'Notice deleted');
}
