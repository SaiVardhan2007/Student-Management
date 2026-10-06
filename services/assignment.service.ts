import type { Ctx } from '@/lib/context';
import { Assignment, Submission, Student, Enrollment } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { studentProfile } from '@/lib/auth';
import { assertSubjectAccess } from '@/services/access';
import { visibleSubjectIds } from '@/services/scope';
import { notifyStudents, notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';
import { toFileMeta, removeFile } from '@/lib/upload';

const POPULATE = [
  { path: 'subject', select: 'code name' },
  { path: 'sections', select: 'name' },
];

export async function list(ctx: Ctx) {
  const filter = filtersFromQuery(ctx.query, { subject: 'id' });
  const subjects = await visibleSubjectIds(ctx);
  if (subjects)
    filter.subject = filter.subject
      ? subjects.some((s) => String(s) === String(filter.subject))
        ? filter.subject
        : null
      : { $in: subjects };
  let student;
  if (ctx.user.role === 'student') {
    student = await studentProfile(ctx);
    filter.$and = [{ $or: [{ sections: { $size: 0 } }, { sections: student.section }] }];
  }
  const { items, meta } = await paginate(Assignment, ctx, {
    filter,
    searchFields: ['title'],
    allowedSort: ['deadline', 'title', 'createdAt'],
    defaultSort: { deadline: -1 },
    populate: POPULATE,
  });

  let out = items;
  if (student) {
    const subs = await Submission.find({ student: student._id, assignment: { $in: items.map((a) => a._id) } })
      .select('assignment status marks feedback submittedAt')
      .lean();
    const map = new Map(subs.map((s) => [String(s.assignment), s]));
    out = items.map((a) => {
      const s = map.get(String(a._id));
      return { ...a, submission: s || null, submissionStatus: s ? s.status : new Date(a.deadline) < new Date() ? 'overdue' : 'pending' };
    });
    const st = ctx.query.status;
    if (st) out = out.filter((a) => a.submissionStatus === st);
  }
  return ok(out, 'OK', 200, meta);
}

export async function get(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const a = await Assignment.findById(ctx.params.id).populate(POPULATE).lean<any>();
  if (!a) throw AppError.notFound('Assignment not found');
  const subjects = await visibleSubjectIds(ctx);
  if (subjects && !subjects.some((s) => String(s) === String(a.subject._id))) throw AppError.forbidden();
  if (ctx.user.role === 'student') {
    const student = await studentProfile(ctx);
    a.submission = await Submission.findOne({ assignment: a._id, student: student._id }).lean();
  }
  return ok(a);
}

export async function create(ctx: Ctx) {
  const subject = await assertSubjectAccess(ctx, ctx.body.subject);
  const a = await Assignment.create({
    ...ctx.body,
    createdBy: ctx.user._id,
    attachment: ctx.file ? toFileMeta(ctx.file, 'assignments') : undefined,
  });
  await notifyStudents(
    { program: subject.program, semester: subject.semester, ...(a.sections?.length ? { section: { $in: a.sections } } : {}) },
    {
      title: `New assignment: ${a.title}`,
      message: `${subject.code} — due ${a.deadline.toDateString()}`,
      type: 'assignment',
      link: '/assignments',
    }
  );
  await audit(ctx, 'ASSIGNMENT_CREATED', 'Assignment', a._id);
  return created(a, 'Assignment created');
}

async function loadOwned(ctx) {
  requireValidId(ctx.params.id);
  const a = await Assignment.findById(ctx.params.id);
  if (!a) throw AppError.notFound('Assignment not found');
  await assertSubjectAccess(ctx, a.subject);
  return a;
}

export async function update(ctx: Ctx) {
  const a = await loadOwned(ctx);
  if (ctx.body.subject && String(ctx.body.subject) !== String(a.subject)) await assertSubjectAccess(ctx, ctx.body.subject);
  a.set(ctx.body);
  if (ctx.file) {
    removeFile(a.attachment);
    a.attachment = toFileMeta(ctx.file, 'assignments');
  }
  if (ctx.body.deadline) a.reminderSentAt = undefined;
  await a.save();
  await audit(ctx, 'ASSIGNMENT_UPDATED', 'Assignment', a._id);
  return ok(a, 'Assignment updated');
}

export async function remove(ctx: Ctx) {
  const a = await loadOwned(ctx);
  const subs = await Submission.find({ assignment: a._id });
  subs.forEach((s) => s.files.forEach(removeFile));
  await Submission.deleteMany({ assignment: a._id });
  removeFile(a.attachment);
  await a.deleteOne();
  await audit(ctx, 'ASSIGNMENT_DELETED', 'Assignment', a._id);
  return ok(null, 'Assignment deleted');
}

export async function submit(ctx: Ctx) {
  const student = await studentProfile(ctx);
  requireValidId(ctx.params.id);
  const a = await Assignment.findById(ctx.params.id);
  if (!a) throw AppError.notFound('Assignment not found');
  const enrolled = await Enrollment.exists({ student: student._id, subject: a.subject, status: 'enrolled' });
  if (!enrolled || (a.sections?.length && !a.sections.some((s) => String(s) === String(student.section))))
    throw AppError.forbidden('This assignment is not assigned to you');
  const files = (ctx.files || []).map((f) => toFileMeta(f, 'submissions'));
  if (!files.length && !ctx.body.text) throw AppError.badRequest('Attach at least one file or write an answer');

  const existing = await Submission.findOne({ assignment: a._id, student: student._id });
  if (existing?.status === 'evaluated')
    throw AppError.conflict('This submission has already been evaluated and can no longer be changed');
  const isLate = new Date() > a.deadline;
  let sub;
  if (existing) {
    if (files.length) {
      existing.files.forEach(removeFile);
      existing.files = files;
    }
    existing.text = ctx.body.text ?? existing.text;
    existing.submittedAt = new Date();
    existing.status = isLate ? 'late' : 'submitted';
    sub = await existing.save();
  } else {
    sub = await Submission.create({
      assignment: a._id,
      student: student._id,
      text: ctx.body.text,
      files,
      status: isLate ? 'late' : 'submitted',
    });
  }
  await audit(ctx, 'ASSIGNMENT_SUBMITTED', 'Submission', sub._id, { late: isLate });
  return created(sub, isLate ? 'Submitted (marked as late)' : 'Assignment submitted');
}

export async function submissions(ctx: Ctx) {
  const a = await loadOwned(ctx);
  const enrolled = await Enrollment.find({ subject: a.subject, status: 'enrolled' }).select('student').lean();
  const students = await Student.find({
    _id: { $in: enrolled.map((e) => e.student) },
    status: 'active',
    ...(a.sections?.length ? { section: { $in: a.sections } } : {}),
  })
    .select('studentId firstName lastName')
    .sort({ studentId: 1 })
    .lean();
  const subs = await Submission.find({ assignment: a._id }).lean();
  const map = new Map(subs.map((s) => [String(s.student), s]));
  return ok({
    assignment: { _id: a._id, title: a.title, maxMarks: a.maxMarks, deadline: a.deadline },
    rows: students.map((s) => ({
      student: s,
      submission: map.get(String(s._id)) || null,
      status: map.get(String(s._id))?.status || 'pending',
    })),
  });
}

export async function evaluate(ctx: Ctx) {
  requireValidId(ctx.params.submissionId, 'submission');
  const sub = await Submission.findById(ctx.params.submissionId);
  if (!sub) throw AppError.notFound('Submission not found');
  const a = await Assignment.findById(sub.assignment);
  await assertSubjectAccess(ctx, a.subject);
  if (ctx.body.marks > a.maxMarks) throw AppError.badRequest(`Marks cannot exceed the maximum (${a.maxMarks})`);
  sub.set({ marks: ctx.body.marks, feedback: ctx.body.feedback, status: 'evaluated', evaluatedBy: ctx.user._id, evaluatedAt: new Date() });
  await sub.save();
  const student = await Student.findById(sub.student).select('user');
  if (student?.user)
    await notifyUsers([student.user], {
      title: 'Assignment evaluated',
      message: `"${a.title}": ${sub.marks}/${a.maxMarks}`,
      type: 'marks',
      link: '/assignments',
    });
  await audit(ctx, 'SUBMISSION_EVALUATED', 'Submission', sub._id, { marks: sub.marks });
  return ok(sub, 'Submission evaluated');
}
