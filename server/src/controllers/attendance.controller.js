import { Attendance, AttendanceCorrection, Enrollment, Student, Subject, Section, getSettings } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, created, toDay, requireValidId, paginate } from '../utils/http.js';
import { studentProfile, facultyProfile } from '../middleware/auth.js';
import { assertSubjectAccess, assertStudentAccess, ownStudentIds } from '../services/access.js';
import { summarize, subjectPercentages, percentage } from '../services/attendance.js';
import { notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';

const optDay = (v) => (v ? toDay(v) : undefined);

/** Sections a subject is taught to (explicit list, or all sections of program+semester). */
async function sectionsForSubject(subject) {
  const filter = subject.sections?.length ? { _id: { $in: subject.sections } } : { program: subject.program, semester: subject.semester };
  return Section.find({ ...filter, isActive: true }).select('name batch semester').sort({ name: 1 }).lean();
}

/** Classes = subject × section pairs for the "select class" step. */
export const classes = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.user.role === 'faculty') filter.faculty = (await facultyProfile(req))._id;
  const subjects = await Subject.find(filter).populate('program', 'name code').sort({ code: 1 }).lean();
  const out = [];
  for (const s of subjects) {
    out.push({ subject: { _id: s._id, code: s.code, name: s.name, semester: s.semester, program: s.program }, sections: await sectionsForSubject(s) });
  }
  ok(res, out);
});

/** Students of a section enrolled in a subject, with attendance already marked for the date. */
async function buildRoster(subject, sectionId, date) {
  const enrolled = await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean();
  const students = await Student.find({ _id: { $in: enrolled.map((e) => e.student) }, section: sectionId, status: 'active' })
    .select('studentId firstName lastName')
    .sort({ studentId: 1 })
    .lean();
  const existing = date ? await Attendance.find({ subject: subject._id, date, student: { $in: students.map((s) => s._id) } }).lean() : [];
  const byStudent = new Map(existing.map((a) => [String(a.student), a]));
  return students.map((s) => ({ ...s, attendance: byStudent.get(String(s._id)) ? { _id: byStudent.get(String(s._id))._id, status: byStudent.get(String(s._id)).status, remarks: byStudent.get(String(s._id)).remarks } : null }));
}

export const roster = asyncHandler(async (req, res) => {
  const { subject: subjectId, section, date } = req.query;
  requireValidId(subjectId, 'subject');
  requireValidId(section, 'section');
  const subject = await assertSubjectAccess(req, subjectId);
  const day = toDay(date);
  ok(res, { date: day, students: await buildRoster(subject, section, day) });
});

export const mark = asyncHandler(async (req, res) => {
  const { subject: subjectId, section, date, records } = req.body;
  const subject = await assertSubjectAccess(req, subjectId);
  const day = toDay(date);
  // one day of slack so users ahead of UTC can record "today" in their local calendar
  const latest = toDay(new Date(Date.now() + 86400000));
  if (day > latest) throw AppError.badRequest('Attendance cannot be marked for a future date');

  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.student)) throw AppError.badRequest('Duplicate student in attendance records', [{ field: 'records', message: `Student ${r.student} appears more than once` }]);
    seen.add(r.student);
  }
  // every student must belong to the section and be enrolled in the subject
  const roster = await buildRoster(subject, section, day);
  const allowed = new Map(roster.map((s) => [String(s._id), s]));
  const invalid = records.filter((r) => !allowed.has(r.student));
  if (invalid.length) throw AppError.badRequest(`${invalid.length} student(s) are not enrolled in this subject/section`, invalid.map((i) => ({ field: 'records', message: `Student ${i.student} is not in this class` })));

  const ops = [];
  let changed = 0;
  for (const r of records) {
    const prev = allowed.get(r.student).attendance;
    if (prev && prev.status === r.status && (prev.remarks || '') === (r.remarks || '')) continue;
    changed++;
    ops.push({
      updateOne: {
        filter: { subject: subject._id, student: r.student, date: day },
        update: {
          $set: { status: r.status, remarks: r.remarks, section, ...(prev ? { modifiedBy: req.user._id, modifiedAt: new Date() } : {}) },
          $setOnInsert: { markedBy: req.user._id },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });
  await audit(req, prev_changed(roster) ? 'ATTENDANCE_CHANGED' : 'ATTENDANCE_MARKED', 'Attendance', subject._id, { date: day, section, changed, total: records.length });

  // attendance warnings for absent students who dropped below the threshold
  const absentIds = records.filter((r) => r.status === 'absent').map((r) => r.student);
  if (absentIds.length) warnLowAttendance(subject, absentIds).catch(() => {});
  ok(res, { saved: changed, unchanged: records.length - changed }, 'Attendance saved');
});

const prev_changed = (roster) => roster.some((s) => s.attendance);

async function warnLowAttendance(subject, studentIds) {
  const settings = await getSettings();
  const pcts = await subjectPercentages(subject._id, studentIds);
  const low = studentIds.filter((id) => {
    const p = percentage(pcts.get(String(id)) || {});
    return p !== null && p < settings.attendanceThreshold;
  });
  if (!low.length) return;
  const students = await Student.find({ _id: { $in: low } }).select('user').lean();
  await notifyUsers(students.map((s) => s.user), {
    title: 'Attendance warning',
    message: `Your attendance in ${subject.code} - ${subject.name} is below ${settings.attendanceThreshold}%.`,
    type: 'attendance',
    link: '/attendance',
  });
}

async function resolveStudentId(req) {
  const { id } = req.params;
  if (id === 'me') {
    if (req.user.role !== 'student') throw AppError.badRequest('Use a student id');
    return (await studentProfile(req))._id;
  }
  requireValidId(id, 'student id');
  await assertStudentAccess(req, id);
  return id;
}

export const studentSummary = asyncHandler(async (req, res) => {
  const studentId = await resolveStudentId(req);
  const { from, to, subject } = req.query;
  ok(res, await summarize(studentId, { from: optDay(from), to: optDay(to), subject }));
});

export const studentHistory = asyncHandler(async (req, res) => {
  const studentId = await resolveStudentId(req);
  const { from, to, subject } = req.query;
  const filter = { student: studentId };
  if (subject) filter.subject = requireValidId(subject, 'subject');
  if (from || to) filter.date = { ...(from && { $gte: toDay(from) }), ...(to && { $lte: toDay(to) }) };
  // faculty may only see history for their own subjects
  if (req.user.role === 'faculty') {
    const mine = await Subject.find({ faculty: (await facultyProfile(req))._id }).select('_id').lean();
    filter.subject = subject ? (mine.some((m) => String(m._id) === subject) ? subject : null) : { $in: mine.map((m) => m._id) };
  }
  const { items, meta } = await paginate(Attendance, req, { filter, allowedSort: ['date'], defaultSort: { date: -1 }, populate: { path: 'subject', select: 'code name' }, defaultLimit: 31 });
  ok(res, items, 'OK', 200, meta);
});

/** Class report: attendance % per student for one subject/section. */
export const classReport = asyncHandler(async (req, res) => {
  const { subject: subjectId, section, from, to } = req.query;
  requireValidId(subjectId, 'subject');
  const subject = await assertSubjectAccess(req, subjectId);
  const students = await buildRoster(subject, section && requireValidId(section, 'section'), null).catch(() => []);
  const list = section ? students : await Student.find({ _id: { $in: (await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean()).map((e) => e.student) } }).select('studentId firstName lastName').lean();
  const settings = await getSettings();
  const pcts = await subjectPercentages(subject._id, list.map((s) => s._id), { from: optDay(from), to: optDay(to) });
  const rows = list.map((s) => {
    const c = pcts.get(String(s._id)) || { present: 0, absent: 0, late: 0, excused: 0 };
    const pct = percentage(c);
    return { student: { _id: s._id, studentId: s.studentId, firstName: s.firstName, lastName: s.lastName }, ...c, percentage: pct, belowThreshold: pct !== null && pct < settings.attendanceThreshold };
  });
  ok(res, { threshold: settings.attendanceThreshold, subject: { _id: subject._id, code: subject.code, name: subject.name }, rows });
});

// ---------------- corrections ----------------
export const requestCorrection = asyncHandler(async (req, res) => {
  const s = await studentProfile(req);
  const { attendance: attendanceId, requestedStatus, reason } = req.body;
  const att = await Attendance.findOne({ _id: attendanceId, student: s._id });
  if (!att) throw AppError.notFound('Attendance record not found');
  if (att.status === requestedStatus) throw AppError.badRequest('Requested status is the same as the current status');
  if (await AttendanceCorrection.exists({ attendance: att._id, status: 'pending' })) throw AppError.conflict('A correction request for this record is already pending');
  const c = await AttendanceCorrection.create({ attendance: att._id, student: s._id, subject: att.subject, requestedStatus, reason });
  const subject = await Subject.findById(att.subject).populate('faculty', 'user');
  if (subject?.faculty?.user) await notifyUsers([subject.faculty.user], { title: 'Attendance correction requested', message: `${s.firstName} ${s.lastName} requested a correction for ${subject.code}.`, type: 'attendance', link: '/attendance/corrections' });
  await audit(req, 'ATTENDANCE_CORRECTION_REQUESTED', 'AttendanceCorrection', c._id);
  created(res, c, 'Correction request submitted');
});

export const listCorrections = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.user.role === 'student') filter.student = (await studentProfile(req))._id;
  else if (req.user.role === 'parent') filter.student = { $in: await ownStudentIds(req) };
  else if (req.user.role === 'faculty') {
    const mine = await Subject.find({ faculty: (await facultyProfile(req))._id }).select('_id').lean();
    filter.subject = { $in: mine.map((m) => m._id) };
  }
  const { items, meta } = await paginate(AttendanceCorrection, req, {
    filter,
    allowedSort: ['createdAt', 'status'],
    populate: [
      { path: 'student', select: 'studentId firstName lastName' },
      { path: 'subject', select: 'code name' },
      { path: 'attendance', select: 'date status' },
    ],
  });
  ok(res, items, 'OK', 200, meta);
});

export const reviewCorrection = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const c = await AttendanceCorrection.findById(req.params.id);
  if (!c) throw AppError.notFound('Correction request not found');
  if (c.status !== 'pending') throw AppError.conflict('This request has already been reviewed');
  await assertSubjectAccess(req, c.subject);
  const { status, reviewNote } = req.body;
  c.set({ status, reviewNote, reviewedBy: req.user._id, reviewedAt: new Date() });
  if (status === 'approved') {
    await Attendance.updateOne({ _id: c.attendance }, { status: c.requestedStatus, modifiedBy: req.user._id, modifiedAt: new Date() });
  }
  await c.save();
  const student = await Student.findById(c.student).select('user');
  if (student?.user) await notifyUsers([student.user], { title: `Attendance correction ${status}`, message: reviewNote || `Your correction request was ${status}.`, type: 'attendance', link: '/attendance' });
  await audit(req, status === 'approved' ? 'ATTENDANCE_CORRECTION_APPROVED' : 'ATTENDANCE_CORRECTION_REJECTED', 'AttendanceCorrection', c._id);
  ok(res, c, `Request ${status}`);
});
