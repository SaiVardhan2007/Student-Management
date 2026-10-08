// Notices/announcements: who can post, who can see them, and who gets notified.
import { Notice, User, Faculty, Student } from '@/models';
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

/** Matches documents where the field is missing/empty, or equals the given value. */
function emptyOrEquals(field: string, value: any) {
  return { $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: value }] };
}

/**
 * Mongo filter for the notices the current user is allowed to see.
 * - admin: everything (or only live notices if ?active=true)
 * - faculty: their own notices, plus live notices meant for all/faculty
 * - student/parent: live notices for their audience that target their department/program/section/year
 */
export async function visibilityFilter(ctx: Ctx) {
  const now = new Date();
  // "live" = already published and not expired
  const live = [
    { publishDate: { $lte: now } },
    { $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gt: now } }] },
  ];
  const { role } = ctx.user;
  if (role === 'admin') return ctx.query.active === 'true' ? { $and: live } : {};
  if (role === 'faculty') {
    return { $or: [{ createdBy: ctx.user._id }, { $and: [...live, { audience: { $in: ['all', 'faculty'] } }] }] };
  }

  const students = await ownStudents(ctx);
  const audience = role === 'parent' ? ['all', 'parents', 'students'] : ['all', 'students'];
  // a notice matches a student if each target field is empty or equals the student's value
  const targets = students.map((s: any) => ({
    $and: [
      emptyOrEquals('department', s.department),
      emptyOrEquals('program', s.program),
      emptyOrEquals('section', s.section),
      emptyOrEquals('year', yearOfSemester(s.semester)),
    ],
  }));
  // no students linked -> match nothing
  const matchesAnyStudent = targets.length ? targets : [{ _id: null }];
  return { $and: [...live, { audience: { $in: audience } }, { $or: matchesAnyStudent }] };
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
  // faculty may only post to classes they teach, and only to students
  if (!body.section) throw AppError.forbidden('Faculty notices must target one of your class sections');
  if (!(await facultyTeachesSection(ctx, body.section))) throw AppError.forbidden('You do not teach the selected section');
  body.audience = 'students';
}

/** Send a notification to everyone the notice is meant for. */
export async function announce(n: any) {
  const filter: Record<string, any> = {};
  for (const k of ['department', 'program', 'section']) if (n[k]) filter[k] = n[k];
  if (n.year) filter.semester = { $in: [n.year * 2 - 1, n.year * 2] }; // year 2 = semesters 3 and 4
  const payload = { title: `Notice: ${n.title}`, message: n.description.slice(0, 140), type: 'notice', link: '/notices' };
  if (['all', 'students'].includes(n.audience)) await notifyStudents(filter, payload);
  if (['all', 'faculty'].includes(n.audience)) {
    const facultyFilter: Record<string, any> = { status: 'active' };
    if (n.department) facultyFilter.department = n.department;
    const faculty = await Faculty.find(facultyFilter).select('user').lean();
    await notifyUsers(
      faculty.map((f: any) => f.user),
      payload
    );
  }
  if (n.audience === 'parents') {
    // only parents of students the notice targets (department/program/section/year)
    const kids = await Student.find({ ...filter, status: 'active' }).select('_id').lean();
    const parents = await User.find({ role: 'parent', isActive: true, children: { $in: kids.map((k: any) => k._id) } })
      .select('_id')
      .lean();
    await notifyUsers(
      parents.map((p: any) => p._id),
      payload
    );
  }
}

/** Announce a notice once it is live. The announcedAt claim is atomic, so it is never sent twice. */
export async function announceIfDue(id: unknown, now = new Date()) {
  const n = await Notice.findOneAndUpdate(
    { _id: id, publishDate: { $lte: now }, announcedAt: { $exists: false } },
    { $set: { announcedAt: now } },
    { new: true }
  );
  if (!n) return false;
  await announce(n);
  return true;
}

/** Job: announce scheduled notices whose publish date has arrived. Returns how many were announced. */
export async function announceDueNotices(now = new Date()) {
  // notices published immediately were announced at creation (publishDate <= createdAt), so only scheduled ones are candidates
  const due = await Notice.find({
    publishDate: { $lte: now },
    announcedAt: { $exists: false },
    $expr: { $gt: ['$publishDate', '$createdAt'] },
    $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gt: now } }],
  })
    .select('_id')
    .lean();
  let count = 0;
  for (const n of due) if (await announceIfDue(n._id, now)) count++;
  return count;
}

export async function create(ctx: Ctx) {
  await assertMayPublish(ctx, ctx.body);
  const n = await Notice.create({
    ...ctx.body,
    createdBy: ctx.user._id,
    attachment: ctx.file ? toFileMeta(ctx.file, 'notices') : undefined,
  });
  await announceIfDue(n._id);
  await audit(ctx, 'NOTICE_CREATED', 'Notice', n._id, { title: n.title });
  return created(n, 'Notice published');
}

/** Load the notice from the URL id. Non-admins may only touch notices they created. */
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
  // notices published immediately were announced at creation (before announcedAt existed); never re-announce them on edit
  const announcedAlready = !!n.announcedAt || n.publishDate <= n.createdAt;
  n.set(ctx.body);
  if (ctx.user.role === 'faculty') n.audience = 'students';
  if (ctx.file) {
    removeFile(n.attachment);
    n.attachment = toFileMeta(ctx.file, 'notices');
  }
  await n.save();
  // a scheduled notice moved to now/the past is announced once; already-announced notices are never re-sent
  if (!announcedAlready) await announceIfDue(n._id);
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
