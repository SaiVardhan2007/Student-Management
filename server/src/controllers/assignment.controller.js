import { Assignment, Submission, Student, Enrollment } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { studentProfile } from '../middleware/auth.js';
import { assertSubjectAccess } from '../services/access.js';
import { visibleSubjectIds } from '../services/scope.js';
import { notifyStudents, notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';
import { toFileMeta, removeFile, removeUploaded } from '../middleware/upload.js';

const POPULATE = [
  { path: 'subject', select: 'code name' },
  { path: 'sections', select: 'name' },
];

export const list = asyncHandler(async (req, res) => {
  const filter = filtersFromQuery(req.query, { subject: 'id' });
  const subjects = await visibleSubjectIds(req);
  if (subjects)
    filter.subject = filter.subject
      ? subjects.some((s) => String(s) === String(filter.subject))
        ? filter.subject
        : null
      : { $in: subjects };
  let student;
  if (req.user.role === 'student') {
    student = await studentProfile(req);
    filter.$and = [{ $or: [{ sections: { $size: 0 } }, { sections: student.section }] }];
  }
  const { items, meta } = await paginate(Assignment, req, {
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
    const st = req.query.status;
    if (st) out = out.filter((a) => a.submissionStatus === st);
  }
  ok(res, out, 'OK', 200, meta);
});

export const get = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const a = await Assignment.findById(req.params.id).populate(POPULATE).lean();
  if (!a) throw AppError.notFound('Assignment not found');
  const subjects = await visibleSubjectIds(req);
  if (subjects && !subjects.some((s) => String(s) === String(a.subject._id))) throw AppError.forbidden();
  if (req.user.role === 'student') {
    const student = await studentProfile(req);
    a.submission = await Submission.findOne({ assignment: a._id, student: student._id }).lean();
  }
  ok(res, a);
});

export const create = asyncHandler(async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.body.subject);
    const a = await Assignment.create({
      ...req.body,
      createdBy: req.user._id,
      attachment: req.file ? toFileMeta(req.file, 'assignments') : undefined,
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
    await audit(req, 'ASSIGNMENT_CREATED', 'Assignment', a._id);
    created(res, a, 'Assignment created');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
});

async function loadOwned(req) {
  requireValidId(req.params.id);
  const a = await Assignment.findById(req.params.id);
  if (!a) throw AppError.notFound('Assignment not found');
  await assertSubjectAccess(req, a.subject);
  return a;
}

export const update = asyncHandler(async (req, res) => {
  try {
    const a = await loadOwned(req);
    if (req.body.subject && String(req.body.subject) !== String(a.subject)) await assertSubjectAccess(req, req.body.subject);
    a.set(req.body);
    if (req.file) {
      removeFile(a.attachment);
      a.attachment = toFileMeta(req.file, 'assignments');
    }
    if (req.body.deadline) a.reminderSentAt = undefined;
    await a.save();
    await audit(req, 'ASSIGNMENT_UPDATED', 'Assignment', a._id);
    ok(res, a, 'Assignment updated');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
});

export const remove = asyncHandler(async (req, res) => {
  const a = await loadOwned(req);
  const subs = await Submission.find({ assignment: a._id });
  subs.forEach((s) => s.files.forEach(removeFile));
  await Submission.deleteMany({ assignment: a._id });
  removeFile(a.attachment);
  await a.deleteOne();
  await audit(req, 'ASSIGNMENT_DELETED', 'Assignment', a._id);
  ok(res, null, 'Assignment deleted');
});

export const submit = asyncHandler(async (req, res) => {
  try {
    const student = await studentProfile(req);
    requireValidId(req.params.id);
    const a = await Assignment.findById(req.params.id);
    if (!a) throw AppError.notFound('Assignment not found');
    const enrolled = await Enrollment.exists({ student: student._id, subject: a.subject, status: 'enrolled' });
    if (!enrolled || (a.sections?.length && !a.sections.some((s) => String(s) === String(student.section))))
      throw AppError.forbidden('This assignment is not assigned to you');
    const files = (req.files || []).map((f) => toFileMeta(f, 'submissions'));
    if (!files.length && !req.body.text) throw AppError.badRequest('Attach at least one file or write an answer');

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
      existing.text = req.body.text ?? existing.text;
      existing.submittedAt = new Date();
      existing.status = isLate ? 'late' : 'submitted';
      sub = await existing.save();
    } else {
      sub = await Submission.create({
        assignment: a._id,
        student: student._id,
        text: req.body.text,
        files,
        status: isLate ? 'late' : 'submitted',
      });
    }
    await audit(req, 'ASSIGNMENT_SUBMITTED', 'Submission', sub._id, { late: isLate });
    created(res, sub, isLate ? 'Submitted (marked as late)' : 'Assignment submitted');
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
});

export const submissions = asyncHandler(async (req, res) => {
  const a = await loadOwned(req);
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
  ok(res, {
    assignment: { _id: a._id, title: a.title, maxMarks: a.maxMarks, deadline: a.deadline },
    rows: students.map((s) => ({
      student: s,
      submission: map.get(String(s._id)) || null,
      status: map.get(String(s._id))?.status || 'pending',
    })),
  });
});

export const evaluate = asyncHandler(async (req, res) => {
  requireValidId(req.params.submissionId, 'submission');
  const sub = await Submission.findById(req.params.submissionId);
  if (!sub) throw AppError.notFound('Submission not found');
  const a = await Assignment.findById(sub.assignment);
  await assertSubjectAccess(req, a.subject);
  if (req.body.marks > a.maxMarks) throw AppError.badRequest(`Marks cannot exceed the maximum (${a.maxMarks})`);
  sub.set({ marks: req.body.marks, feedback: req.body.feedback, status: 'evaluated', evaluatedBy: req.user._id, evaluatedAt: new Date() });
  await sub.save();
  const student = await Student.findById(sub.student).select('user');
  if (student?.user)
    await notifyUsers([student.user], {
      title: 'Assignment evaluated',
      message: `"${a.title}": ${sub.marks}/${a.maxMarks}`,
      type: 'marks',
      link: '/assignments',
    });
  await audit(req, 'SUBMISSION_EVALUATED', 'Submission', sub._id, { marks: sub.marks });
  ok(res, sub, 'Submission evaluated');
});
