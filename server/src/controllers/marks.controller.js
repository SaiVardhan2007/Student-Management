import { Mark, Enrollment, Student, getSettings } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, requireValidId } from '../utils/http.js';
import { studentProfile } from '../middleware/auth.js';
import { assertSubjectAccess, assertStudentAccess } from '../services/access.js';
import { computeResults, gradeFor } from '../services/grading.js';
import { notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';

/** Enter/update marks for many students of one subject and component. */
export const enter = asyncHandler(async (req, res) => {
  const { subject: subjectId, examType, maxMarks, records } = req.body;
  const subject = await assertSubjectAccess(req, subjectId);

  const bad = records.filter((r) => r.marksObtained > maxMarks);
  if (bad.length)
    throw AppError.badRequest(
      'Marks obtained cannot exceed maximum marks',
      bad.map((b) => ({ field: 'records', message: `Student ${b.student}: ${b.marksObtained} > ${maxMarks}` }))
    );

  const enrolled = new Set(
    (await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean()).map((e) => String(e.student))
  );
  const notEnrolled = records.filter((r) => !enrolled.has(r.student));
  if (notEnrolled.length)
    throw AppError.badRequest(
      `${notEnrolled.length} student(s) are not enrolled in this subject`,
      notEnrolled.map((n) => ({ field: 'records', message: `Student ${n.student} is not enrolled` }))
    );

  const existing = await Mark.find({ subject: subject._id, examType, student: { $in: records.map((r) => r.student) } }).lean();
  const prev = new Map(existing.map((m) => [String(m.student), m]));
  const changes = [];
  const ops = [];
  for (const r of records) {
    const old = prev.get(r.student);
    if (old && old.marksObtained === r.marksObtained && old.maxMarks === maxMarks && (old.remarks || '') === (r.remarks || '')) continue;
    if (old) changes.push({ student: r.student, from: old.marksObtained, to: r.marksObtained });
    ops.push({
      updateOne: {
        filter: { student: r.student, subject: subject._id, examType },
        update: {
          $set: {
            marksObtained: r.marksObtained,
            maxMarks,
            remarks: r.remarks,
            semester: subject.semester,
            ...(old ? { updatedBy: req.user._id } : {}),
          },
          $setOnInsert: { enteredBy: req.user._id },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await Mark.bulkWrite(ops, { ordered: false });
  await audit(req, changes.length ? 'MARKS_CHANGED' : 'MARKS_ENTERED', 'Mark', subject._id, {
    examType,
    entered: ops.length,
    changes: changes.slice(0, 50),
  });

  if (ops.length) {
    const students = await Student.find({ _id: { $in: records.map((r) => r.student) } })
      .select('user')
      .lean();
    notifyUsers(
      students.map((s) => s.user),
      {
        title: 'New marks published',
        message: `${examType} marks for ${subject.code} - ${subject.name} are available.`,
        type: 'marks',
        link: '/results',
      }
    );
  }
  ok(res, { saved: ops.length, unchanged: records.length - ops.length }, 'Marks saved');
});

/** Class sheet: roster + marks for a subject (optionally a single component). */
export const subjectMarks = asyncHandler(async (req, res) => {
  requireValidId(req.params.subjectId, 'subject');
  const subject = await assertSubjectAccess(req, req.params.subjectId);
  const { examType, section } = req.query;
  const enrolled = await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean();
  const sFilter = { _id: { $in: enrolled.map((e) => e.student) }, status: 'active' };
  if (section) sFilter.section = requireValidId(String(section), 'section');
  const students = await Student.find(sFilter).select('studentId firstName lastName section').sort({ studentId: 1 }).lean();
  const mFilter = { subject: subject._id, student: { $in: students.map((s) => s._id) } };
  if (examType) mFilter.examType = String(examType);
  const marks = await Mark.find(mFilter).lean();
  const byStudent = new Map();
  for (const m of marks) {
    if (!byStudent.has(String(m.student))) byStudent.set(String(m.student), {});
    byStudent.get(String(m.student))[m.examType] = { marksObtained: m.marksObtained, maxMarks: m.maxMarks, remarks: m.remarks };
  }
  ok(res, {
    subject: { _id: subject._id, code: subject.code, name: subject.name },
    students: students.map((s) => ({ ...s, marks: byStudent.get(String(s._id)) || {} })),
  });
});

export const performance = asyncHandler(async (req, res) => {
  requireValidId(req.params.subjectId, 'subject');
  const subject = await assertSubjectAccess(req, req.params.subjectId);
  const settings = await getSettings();
  const marks = await Mark.find({ subject: subject._id }).lean();
  const perStudent = new Map();
  for (const m of marks) {
    const e = perStudent.get(String(m.student)) || { o: 0, m: 0 };
    e.o += m.marksObtained;
    e.m += m.maxMarks;
    perStudent.set(String(m.student), e);
  }
  const pcts = [...perStudent.values()].map((e) => (e.m ? (e.o / e.m) * 100 : 0));
  const dist = {};
  for (const p of pcts) {
    const g = gradeFor(p, settings.gradeScale).grade;
    dist[g] = (dist[g] || 0) + 1;
  }
  const round = (n) => Math.round(n * 100) / 100;
  ok(res, {
    students: pcts.length,
    average: pcts.length ? round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0,
    highest: pcts.length ? round(Math.max(...pcts)) : 0,
    lowest: pcts.length ? round(Math.min(...pcts)) : 0,
    passRate: pcts.length ? round((pcts.filter((p) => p >= settings.passPercentage).length / pcts.length) * 100) : 0,
    gradeDistribution: Object.entries(dist).map(([grade, count]) => ({ grade, count })),
  });
});

export const studentResults = asyncHandler(async (req, res) => {
  let { id } = req.params;
  if (id === 'me') {
    if (req.user.role !== 'student') throw AppError.badRequest('Use a student id');
    id = String((await studentProfile(req))._id);
  } else {
    requireValidId(id, 'student id');
    await assertStudentAccess(req, id);
  }
  const semester = req.query.semester ? Number(req.query.semester) : undefined;
  ok(res, await computeResults(id, { semester }));
});

export const remove = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const m = await Mark.findById(req.params.id);
  if (!m) throw AppError.notFound('Mark not found');
  await assertSubjectAccess(req, m.subject);
  await m.deleteOne();
  await audit(req, 'MARKS_DELETED', 'Mark', m._id, { student: m.student, examType: m.examType, marksObtained: m.marksObtained });
  ok(res, null, 'Mark deleted');
});
