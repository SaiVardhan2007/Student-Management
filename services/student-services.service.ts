/**
 * Student-facing services: documents, support tickets (complaints) and achievements.
 */
import { StudentDocument, Complaint, Achievement, Student, User } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { toFileMeta, removeFile } from '@/lib/upload';
import { studentProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { ownStudentIds, visibleStudentScope } from '@/services/access';
import { notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';

// ====================================================================== documents
const DOC_POPULATE = [
  { path: 'student', select: 'studentId firstName lastName' },
  { path: 'reviewedBy', select: 'name' },
];

export async function listDocuments(ctx: Ctx) {
  const filter = filtersFromQuery(ctx.query, { status: 'string', type: 'string', student: 'id' });
  if (ctx.user.role !== 'admin') {
    const ids = await ownStudentIds(ctx);
    filter.student = filter.student && ids.some((i: any) => String(i) === String(filter.student)) ? filter.student : { $in: ids };
  }
  const { items, meta } = await paginate(StudentDocument, ctx, {
    filter,
    searchFields: ['title'],
    allowedSort: ['createdAt', 'status', 'title'],
    populate: DOC_POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function uploadDocument(ctx: Ctx) {
  if (!ctx.file) throw AppError.badRequest('Please choose a file to upload');
  const s = await studentProfile(ctx);
  const d = await StudentDocument.create({ ...ctx.body, student: s._id, file: toFileMeta(ctx.file, 'documents') });
  await audit(ctx, 'DOCUMENT_UPLOADED', 'StudentDocument', d._id, { type: d.type });
  return created(d, 'Document uploaded and awaiting verification');
}

export async function reviewDocument(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const d = await StudentDocument.findById(ctx.params.id);
  if (!d) throw AppError.notFound('Document not found');
  d.set({ status: ctx.body.status, reviewNote: ctx.body.reviewNote, reviewedBy: ctx.user._id, reviewedAt: new Date() });
  await d.save();
  const s = await Student.findById(d.student).select('user');
  if (s?.user)
    await notifyUsers([s.user], {
      title: `Document ${ctx.body.status.replace('_', ' ')}`,
      message: `"${d.title}": ${ctx.body.reviewNote || 'Your document has been verified.'}`,
      type: 'document',
      link: '/documents',
    });
  await audit(ctx, `DOCUMENT_${ctx.body.status.toUpperCase()}`, 'StudentDocument', d._id);
  return ok(d, 'Document reviewed');
}

export async function deleteDocument(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const d = await StudentDocument.findById(ctx.params.id);
  if (!d) throw AppError.notFound('Document not found');
  if (ctx.user.role === 'student') {
    const s = await studentProfile(ctx);
    if (String(d.student) !== String(s._id)) throw AppError.forbidden();
    if (d.status === 'verified') throw AppError.conflict('Verified documents cannot be deleted');
  }
  removeFile(d.file);
  await d.deleteOne();
  await audit(ctx, 'DOCUMENT_DELETED', 'StudentDocument', d._id);
  return ok(null, 'Document deleted');
}

// ====================================================================== complaints
const COMPLAINT_POPULATE = [
  { path: 'student', select: 'studentId firstName lastName' },
  { path: 'assignedTo', select: 'name role' },
];

async function complaintScope(ctx: Ctx) {
  if (ctx.user.role === 'admin') return {};
  if (ctx.user.role === 'faculty') return { assignedTo: ctx.user._id };
  return { student: { $in: await ownStudentIds(ctx) } };
}

export async function listComplaints(ctx: Ctx) {
  const filter = { ...filtersFromQuery(ctx.query, { status: 'string', category: 'string', priority: 'string' }), ...(await complaintScope(ctx)) };
  const { items, meta } = await paginate(Complaint, ctx, {
    filter,
    searchFields: ['subject', 'description'],
    allowedSort: ['createdAt', 'priority', 'status'],
    populate: COMPLAINT_POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function getComplaint(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const c = await Complaint.findOne({ _id: ctx.params.id, ...(await complaintScope(ctx)) }).populate(COMPLAINT_POPULATE);
  if (!c) throw AppError.notFound('Ticket not found');
  return ok(c);
}

export async function createComplaint(ctx: Ctx) {
  const s = await studentProfile(ctx);
  const c = await Complaint.create({
    ...ctx.body,
    student: s._id,
    attachment: ctx.file ? toFileMeta(ctx.file, 'complaints') : undefined,
  });
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
  await notifyUsers(
    admins.map((a: any) => a._id),
    { title: 'New support ticket', message: c.subject, type: 'complaint', link: '/complaints' }
  );
  await audit(ctx, 'COMPLAINT_CREATED', 'Complaint', c._id);
  return created(c, 'Ticket submitted');
}

export async function respondToComplaint(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const c = await Complaint.findOne({ _id: ctx.params.id, ...(await complaintScope(ctx)) });
  if (!c) throw AppError.notFound('Ticket not found');
  if (['resolved', 'closed'].includes(c.status) && ctx.user.role === 'student') throw AppError.conflict('This ticket is closed');
  if (ctx.user.role === 'parent') throw AppError.forbidden();
  c.responses.push({ by: ctx.user._id, byName: ctx.user.name, message: ctx.body.message });
  if (ctx.user.role !== 'student' && ['open', 'assigned'].includes(c.status)) c.status = 'in_progress';
  await c.save();
  const target =
    ctx.user.role === 'student' ? c.assignedTo && [c.assignedTo] : [(await Student.findById(c.student).select('user'))?.user];
  if (target) await notifyUsers(target, { title: 'New reply on support ticket', message: `${c.subject}`, type: 'complaint', link: '/complaints' });
  return ok(c, 'Reply added');
}

export async function updateComplaint(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const c = await Complaint.findOne({ _id: ctx.params.id, ...(await complaintScope(ctx)) });
  if (!c) throw AppError.notFound('Ticket not found');
  const { status, assignedTo } = ctx.body;
  if (ctx.user.role === 'student') {
    // students may only close their own ticket
    if (assignedTo || status !== 'closed') throw AppError.forbidden('Students can only close their own tickets');
  }
  if (assignedTo) {
    if (ctx.user.role !== 'admin') throw AppError.forbidden('Only admins can assign tickets');
    const u = await User.findOne({ _id: assignedTo, role: { $in: ['admin', 'faculty'] }, isActive: true });
    if (!u) throw AppError.badRequest('Assignee must be an active admin or faculty user');
    c.assignedTo = u._id;
    if (c.status === 'open' && !status) c.status = 'assigned';
    await notifyUsers([u._id], { title: 'Support ticket assigned to you', message: c.subject, type: 'complaint', link: '/complaints' });
  }
  if (status) c.status = status;
  await c.save();
  if (status && ctx.user.role !== 'student') {
    const s = await Student.findById(c.student).select('user');
    if (s?.user)
      await notifyUsers([s.user], {
        title: `Ticket ${status.replace('_', ' ')}`,
        message: c.subject,
        type: 'complaint',
        link: '/complaints',
      });
  }
  await audit(ctx, 'COMPLAINT_UPDATED', 'Complaint', c._id, { status: c.status });
  return ok(c, 'Ticket updated');
}

// ====================================================================== achievements
const ACH_POPULATE = [{ path: 'student', select: 'studentId firstName lastName' }];

export async function listAchievements(ctx: Ctx) {
  const filter = filtersFromQuery(ctx.query, { status: 'string', category: 'string', student: 'id' });
  if (ctx.user.role === 'student' || ctx.user.role === 'parent') filter.student = { $in: await ownStudentIds(ctx) };
  else if (ctx.user.role === 'faculty') {
    const scope = await visibleStudentScope(ctx);
    filter.student = { $in: scope.ids };
  }
  const { items, meta } = await paginate(Achievement, ctx, {
    filter,
    searchFields: ['title'],
    allowedSort: ['createdAt', 'date', 'status'],
    populate: ACH_POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function createAchievement(ctx: Ctx) {
  const s = await studentProfile(ctx);
  const a = await Achievement.create({
    ...ctx.body,
    student: s._id,
    certificate: ctx.file ? toFileMeta(ctx.file, 'achievements') : undefined,
  });
  await audit(ctx, 'ACHIEVEMENT_ADDED', 'Achievement', a._id);
  return created(a, 'Achievement added and awaiting verification');
}

export async function verifyAchievement(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const a = await Achievement.findById(ctx.params.id);
  if (!a) throw AppError.notFound('Achievement not found');
  if (ctx.user.role === 'faculty') {
    const scope = await visibleStudentScope(ctx);
    if (!scope.ids!.some((i: any) => String(i) === String(a.student)))
      throw AppError.forbidden('You can only verify achievements of your students');
  }
  a.set({ status: ctx.body.status, verifiedBy: ctx.user._id, verifiedAt: new Date() });
  await a.save();
  const s = await Student.findById(a.student).select('user');
  if (s?.user) await notifyUsers([s.user], { title: `Achievement ${a.status}`, message: a.title, type: 'general', link: '/achievements' });
  await audit(ctx, 'ACHIEVEMENT_' + a.status.toUpperCase(), 'Achievement', a._id);
  return ok(a, 'Achievement reviewed');
}

export async function deleteAchievement(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const a = await Achievement.findById(ctx.params.id);
  if (!a) throw AppError.notFound('Achievement not found');
  if (ctx.user.role === 'student' && String(a.student) !== String((await studentProfile(ctx))._id)) throw AppError.forbidden();
  removeFile(a.certificate);
  await a.deleteOne();
  return ok(null, 'Achievement deleted');
}
