// Attendance service: marking attendance, class rosters/reports, a student's history, and correction requests.
// The percentage maths lives in services/attendance.ts.
import type { Ctx } from '@/lib/context';
import { Attendance, AttendanceCorrection, Enrollment, Student, Subject, Section, getSettings } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { toDay, requireValidId, paginate } from '@/lib/query';
import { studentProfile, facultyProfile } from '@/lib/auth';
import { assertSubjectAccess, assertStudentAccess, ownStudentIds, facultySubjectIds } from '@/services/access';
import { summarize, subjectPercentages, percentage } from '@/services/attendance';
import { notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';

// Convert an optional query value to a day (or undefined when it is missing).
const optDay = (v) => (v ? toDay(v) : undefined);

/** Sections a subject is taught to (explicit list, or all sections of program+semester), picked from `sections`. */
function sectionsForSubject(subject, sections) {
  if (subject.sections?.length) {
    const ids = new Set(subject.sections.map(String));
    return sections.filter((sec) => ids.has(String(sec._id)));
  }
  const program = String(subject.program?._id ?? subject.program);
  return sections.filter((sec) => String(sec.program) === program && sec.semester === subject.semester);
}

/** Classes = subject × section pairs for the "select class" step. */
export async function classes(ctx: Ctx) {
  const filter: Record<string, any> = { isActive: true };
  if (ctx.user.role === 'faculty') filter.faculty = (await facultyProfile(ctx))._id;
  // one query for subjects and one for sections (not one per subject), so the picker loads fast however many subjects there are
  const [subjects, sections] = await Promise.all([
    Subject.find(filter).populate('program', 'name code').sort({ code: 1 }).lean(),
    Section.find({ isActive: true }).select('name batch semester program').sort({ name: 1 }).lean(),
  ]);
  const out = subjects.map((s) => ({
    subject: { _id: s._id, code: s.code, name: s.name, semester: s.semester, program: s.program },
    sections: sectionsForSubject(s, sections).map(({ program: _program, ...sec }) => sec),
  }));
  return ok(out);
}

/** Students of a section enrolled in a subject, with attendance already marked for the date. */
async function buildRoster(subject, sectionId, date) {
  const enrolled = await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean();
  const students = await Student.find({ _id: { $in: enrolled.map((e) => e.student) }, section: sectionId, status: 'active' })
    .select('studentId firstName lastName')
    .sort({ studentId: 1 })
    .lean();
  const existing = date ? await Attendance.find({ subject: subject._id, date, student: { $in: students.map((s) => s._id) } }).lean() : [];
  const byStudent = new Map(existing.map((a) => [String(a.student), a]));
  return students.map((student) => {
    const record = byStudent.get(String(student._id));
    return {
      ...student,
      attendance: record ? { _id: record._id, status: record.status, remarks: record.remarks } : null,
    };
  });
}

/** Student list of one class for a date, with any attendance already saved. */
export async function roster(ctx: Ctx) {
  const { subject: subjectId, section, date } = ctx.query;
  requireValidId(subjectId, 'subject');
  requireValidId(section, 'section');
  const subject = await assertSubjectAccess(ctx, subjectId);
  const day = toDay(date);
  return ok({ date: day, students: await buildRoster(subject, section, day) });
}

/** Save attendance for a class on one day. Only records that changed are written. */
export async function mark(ctx: Ctx) {
  const { subject: subjectId, section, date, records } = ctx.body;
  const subject = await assertSubjectAccess(ctx, subjectId);
  const day = toDay(date);
  // one day of slack so users ahead of UTC can record "today" in their local calendar
  const latest = toDay(new Date(Date.now() + 86400000));
  if (day > latest) throw AppError.badRequest('Attendance cannot be marked for a future date');

  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.student))
      throw AppError.badRequest('Duplicate student in attendance records', [
        { field: 'records', message: `Student ${r.student} appears more than once` },
      ]);
    seen.add(r.student);
  }
  // every student must belong to the section and be enrolled in the subject
  const classRoster = await buildRoster(subject, section, day);
  const allowed = new Map(classRoster.map((s) => [String(s._id), s]));
  const invalid = records.filter((r) => !allowed.has(r.student));
  if (invalid.length)
    throw AppError.badRequest(
      `${invalid.length} student(s) are not enrolled in this subject/section`,
      invalid.map((i) => ({ field: 'records', message: `Student ${i.student} is not in this class` }))
    );

  // build one database write per record, skipping records that did not change
  const ops = [];
  const newlyAbsent = []; // students whose saved record is newly 'absent' (only these get a warning)
  let changed = 0;
  for (const r of records) {
    const prev = allowed.get(r.student).attendance;
    const unchanged = prev && prev.status === r.status && (prev.remarks || '') === (r.remarks || '');
    if (unchanged) continue;
    changed++;
    if (r.status === 'absent' && prev?.status !== 'absent') newlyAbsent.push(r.student);
    ops.push({
      updateOne: {
        filter: { subject: subject._id, student: r.student, date: day },
        update: {
          $set: { status: r.status, section, ...(r.remarks ? { remarks: r.remarks } : {}), ...(prev ? { modifiedBy: ctx.user._id, modifiedAt: new Date() } : {}) },
          ...(r.remarks ? {} : { $unset: { remarks: '' } }),
          $setOnInsert: { markedBy: ctx.user._id },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });
  // if any attendance already existed for this day, this save is an edit
  const alreadyMarked = classRoster.some((s) => s.attendance);
  await audit(ctx, alreadyMarked ? 'ATTENDANCE_CHANGED' : 'ATTENDANCE_MARKED', 'Attendance', subject._id, {
    date: day,
    section,
    changed,
    total: records.length,
  });

  // warn absent students whose percentage dropped below the threshold; runs in the background and must not fail the request
  if (newlyAbsent.length) warnLowAttendance(subject, newlyAbsent).catch(() => {});
  return ok({ saved: changed, unchanged: records.length - changed }, 'Attendance saved');
}

// Notify students whose attendance in this subject is now below the threshold from settings.
async function warnLowAttendance(subject, studentIds) {
  const settings = await getSettings();
  const pcts = await subjectPercentages(subject._id, studentIds);
  const low = studentIds.filter((id) => {
    const p = percentage(pcts.get(String(id)) || {});
    return p !== null && p < settings.attendanceThreshold;
  });
  if (!low.length) return;
  const students = await Student.find({ _id: { $in: low } })
    .select('user')
    .lean();
  await notifyUsers(
    students.map((s) => s.user),
    {
      title: 'Attendance warning',
      message: `Your attendance in ${subject.code} - ${subject.name} is below ${settings.attendanceThreshold}%.`,
      type: 'attendance',
      link: '/attendance',
    }
  );
}

// 'me' means the logged-in student; otherwise check the user is allowed to view that student.
async function resolveStudentId(ctx) {
  const { id } = ctx.params;
  if (id === 'me') {
    if (ctx.user.role !== 'student') throw AppError.badRequest('Use a student id');
    return (await studentProfile(ctx))._id;
  }
  requireValidId(id, 'student id');
  await assertStudentAccess(ctx, id);
  return id;
}

/** Attendance summary (overall, per subject, per month) for one student. */
export async function studentSummary(ctx: Ctx) {
  const studentId = await resolveStudentId(ctx);
  const { from, to, subject } = ctx.query;
  // faculty only see attendance for the subjects they teach
  const subjectIds = ctx.user.role === 'faculty' ? await facultySubjectIds(ctx) : undefined;
  return ok(await summarize(studentId, { from: optDay(from), to: optDay(to), subject, subjectIds }));
}

/** Day-by-day attendance records of one student (paginated). */
export async function studentHistory(ctx: Ctx) {
  const studentId = await resolveStudentId(ctx);
  const { from, to, subject } = ctx.query;
  const filter: Record<string, any> = { student: studentId };
  if (subject) filter.subject = requireValidId(subject, 'subject');
  if (from || to) filter.date = { ...(from && { $gte: toDay(from) }), ...(to && { $lte: toDay(to) }) };
  // faculty may only see history for their own subjects
  if (ctx.user.role === 'faculty') {
    const mine = await Subject.find({ faculty: (await facultyProfile(ctx))._id })
      .select('_id')
      .lean();
    if (!subject) {
      filter.subject = { $in: mine.map((m) => m._id) };
    } else if (!mine.some((m) => String(m._id) === subject)) {
      filter.subject = null; // not their subject, so match nothing
    }
  }
  const { items, meta } = await paginate(Attendance, ctx, {
    filter,
    allowedSort: ['date'],
    defaultSort: { date: -1 },
    populate: { path: 'subject', select: 'code name' },
    defaultLimit: 31,
  });
  return ok(items, 'OK', 200, meta);
}

/** Class report: attendance % per student for one subject/section. */
export async function classReport(ctx: Ctx) {
  const { subject: subjectId, section, from, to } = ctx.query;
  requireValidId(subjectId, 'subject');
  const subject = await assertSubjectAccess(ctx, subjectId);
  let list;
  if (section) {
    requireValidId(section, 'section');
    list = await buildRoster(subject, section, null).catch(() => []);
  } else {
    // no section given: report on every student enrolled in the subject
    const enrolled = await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean();
    list = await Student.find({ _id: { $in: enrolled.map((e) => e.student) } })
      .select('studentId firstName lastName')
      .lean();
  }
  const settings = await getSettings();
  const pcts = await subjectPercentages(
    subject._id,
    list.map((s) => s._id),
    { from: optDay(from), to: optDay(to) }
  );
  const rows = list.map((s) => {
    const c = pcts.get(String(s._id)) || { present: 0, absent: 0, late: 0, excused: 0 };
    const pct = percentage(c);
    return {
      student: { _id: s._id, studentId: s.studentId, firstName: s.firstName, lastName: s.lastName },
      ...c,
      percentage: pct,
      belowThreshold: pct !== null && pct < settings.attendanceThreshold,
    };
  });
  return ok({ threshold: settings.attendanceThreshold, subject: { _id: subject._id, code: subject.code, name: subject.name }, rows });
}

// ---------------- corrections ----------------
/** A student asks the faculty to change one of their attendance records. */
export async function requestCorrection(ctx: Ctx) {
  const s = await studentProfile(ctx);
  const { attendance: attendanceId, requestedStatus, reason } = ctx.body;
  const att = await Attendance.findOne({ _id: attendanceId, student: s._id });
  if (!att) throw AppError.notFound('Attendance record not found');
  if (att.status === requestedStatus) throw AppError.badRequest('Requested status is the same as the current status');
  if (await AttendanceCorrection.exists({ attendance: att._id, status: 'pending' }))
    throw AppError.conflict('A correction request for this record is already pending');
  const c = await AttendanceCorrection.create({ attendance: att._id, student: s._id, subject: att.subject, requestedStatus, reason });
  const subject = await Subject.findById(att.subject).populate('faculty', 'user');
  if (subject?.faculty?.user)
    await notifyUsers([subject.faculty.user], {
      title: 'Attendance correction requested',
      message: `${s.firstName} ${s.lastName} requested a correction for ${subject.code}.`,
      type: 'attendance',
      link: '/attendance/corrections',
    });
  await audit(ctx, 'ATTENDANCE_CORRECTION_REQUESTED', 'AttendanceCorrection', c._id);
  return created(c, 'Correction request submitted');
}

/** Correction requests the user may see (own, children's, or for the faculty's subjects). */
export async function listCorrections(ctx: Ctx) {
  const filter: Record<string, any> = {};
  if (ctx.query.status) filter.status = String(ctx.query.status);
  if (ctx.user.role === 'student') filter.student = (await studentProfile(ctx))._id;
  else if (ctx.user.role === 'parent') filter.student = { $in: await ownStudentIds(ctx) };
  else if (ctx.user.role === 'faculty') {
    const mine = await Subject.find({ faculty: (await facultyProfile(ctx))._id })
      .select('_id')
      .lean();
    filter.subject = { $in: mine.map((m) => m._id) };
  }
  const { items, meta } = await paginate(AttendanceCorrection, ctx, {
    filter,
    allowedSort: ['createdAt', 'status'],
    populate: [
      { path: 'student', select: 'studentId firstName lastName' },
      { path: 'subject', select: 'code name' },
      { path: 'attendance', select: 'date status' },
    ],
  });
  return ok(items, 'OK', 200, meta);
}

/** Faculty approves or rejects a correction. Approving updates the attendance record. */
export async function reviewCorrection(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const c = await AttendanceCorrection.findById(ctx.params.id);
  if (!c) throw AppError.notFound('Correction request not found');
  if (c.status !== 'pending') throw AppError.conflict('This request has already been reviewed');
  await assertSubjectAccess(ctx, c.subject);
  const { status, reviewNote } = ctx.body;
  c.set({ status, reviewNote, reviewedBy: ctx.user._id, reviewedAt: new Date() });
  if (status === 'approved') {
    await Attendance.updateOne({ _id: c.attendance }, { status: c.requestedStatus, modifiedBy: ctx.user._id, modifiedAt: new Date() });
  }
  await c.save();
  const student = await Student.findById(c.student).select('user');
  if (student?.user)
    await notifyUsers([student.user], {
      title: `Attendance correction ${status}`,
      message: reviewNote || `Your correction request was ${status}.`,
      type: 'attendance',
      link: '/attendance',
    });
  await audit(
    ctx,
    status === 'approved' ? 'ATTENDANCE_CORRECTION_APPROVED' : 'ATTENDANCE_CORRECTION_REJECTED',
    'AttendanceCorrection',
    c._id
  );
  return ok(c, `Request ${status}`);
}
