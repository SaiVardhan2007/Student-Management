// Marks: entering, viewing and deleting marks, plus subject performance stats and student results.
import type { Ctx } from '@/lib/context';
import { Mark, Enrollment, Student, getSettings } from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { requireValidId } from '@/lib/query';
import { studentProfile } from '@/lib/auth';
import { assertSubjectAccess, assertStudentAccess, facultySubjectIds } from '@/services/access';
import { computeResults, gradeFor } from '@/services/grading';
import { notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';

/** Enter or update marks for many students of one subject and exam component (e.g. 'midterm'). */
export async function enter(ctx: Ctx) {
  const { subject: subjectId, examType, maxMarks, records } = ctx.body;
  const subject = await assertSubjectAccess(ctx, subjectId);

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

  // one maximum per subject + component: other students' saved marks must use the same maximum
  const clashingMax = await Mark.findOne({
    subject: subject._id,
    examType,
    student: { $nin: records.map((r) => r.student) },
    maxMarks: { $ne: maxMarks },
  }).lean<any>();
  if (clashingMax)
    throw AppError.badRequest(
      `Maximum marks for ${examType} is already ${clashingMax.maxMarks} for other students. Use the same maximum, or include every student when changing it.`,
      [{ field: 'maxMarks', message: `Existing maximum is ${clashingMax.maxMarks}` }]
    );

  const existing = await Mark.find({ subject: subject._id, examType, student: { $in: records.map((r) => r.student) } }).lean();
  const oldMarkByStudent = new Map(existing.map((m) => [String(m.student), m]));
  const changes = []; // edits to already-saved marks (kept in the audit log)
  const ops = []; // database writes to run
  for (const r of records) {
    const old = oldMarkByStudent.get(r.student);
    const isUnchanged = old && old.marksObtained === r.marksObtained && old.maxMarks === maxMarks && (old.remarks || '') === (r.remarks || '');
    if (isUnchanged) continue;
    if (old) changes.push({ student: r.student, from: old.marksObtained, to: r.marksObtained });
    ops.push({
      updateOne: {
        filter: { student: r.student, subject: subject._id, examType },
        update: {
          $set: {
            marksObtained: r.marksObtained,
            maxMarks,
            ...(r.remarks ? { remarks: r.remarks } : {}),
            semester: subject.semester,
            ...(old ? { updatedBy: ctx.user._id } : {}),
          },
          ...(r.remarks ? {} : { $unset: { remarks: '' } }),
          $setOnInsert: { enteredBy: ctx.user._id },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await Mark.bulkWrite(ops, { ordered: false });
  await audit(ctx, changes.length ? 'MARKS_CHANGED' : 'MARKS_ENTERED', 'Mark', subject._id, {
    examType,
    entered: ops.length,
    changes: changes.slice(0, 50),
  });

  if (ops.length) {
    const students = await Student.find({ _id: { $in: records.map((r) => r.student) } })
      .select('user')
      .lean();
    // not awaited on purpose: a slow notification should not delay saving marks
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
  return ok({ saved: ops.length, unchanged: records.length - ops.length }, 'Marks saved');
}

/** Class sheet: the enrolled students of a subject with their marks (optionally one exam component). */
export async function subjectMarks(ctx: Ctx) {
  requireValidId(ctx.params.subjectId, 'subject');
  const subject = await assertSubjectAccess(ctx, ctx.params.subjectId);
  const { examType, section } = ctx.query;
  const enrolled = await Enrollment.find({ subject: subject._id, status: 'enrolled' }).select('student').lean();
  const studentFilter: Record<string, any> = { _id: { $in: enrolled.map((e) => e.student) }, status: 'active' };
  if (section) studentFilter.section = requireValidId(String(section), 'section');
  const students = await Student.find(studentFilter).select('studentId firstName lastName section').sort({ studentId: 1 }).lean();
  const markFilter: Record<string, any> = { subject: subject._id, student: { $in: students.map((s) => s._id) } };
  if (examType) markFilter.examType = String(examType);
  const marks = await Mark.find(markFilter).lean();
  // student id -> { examType: { marksObtained, maxMarks, remarks } }
  const byStudent = new Map();
  for (const m of marks) {
    if (!byStudent.has(String(m.student))) byStudent.set(String(m.student), {});
    byStudent.get(String(m.student))[m.examType] = { marksObtained: m.marksObtained, maxMarks: m.maxMarks, remarks: m.remarks };
  }
  return ok({
    subject: { _id: subject._id, code: subject.code, name: subject.name },
    students: students.map((s) => ({ ...s, marks: byStudent.get(String(s._id)) || {} })),
  });
}

/** Class statistics for a subject: average, highest, lowest, pass rate and grade distribution. */
export async function performance(ctx: Ctx) {
  requireValidId(ctx.params.subjectId, 'subject');
  const subject = await assertSubjectAccess(ctx, ctx.params.subjectId);
  const settings = await getSettings();
  const marks = await Mark.find({ subject: subject._id }).lean();

  // add up each student's marks over all exam components
  const totals = new Map();
  for (const m of marks) {
    const t = totals.get(String(m.student)) || { obtained: 0, max: 0 };
    t.obtained += m.marksObtained;
    t.max += m.maxMarks;
    totals.set(String(m.student), t);
  }
  const percentages: number[] = [];
  for (const t of totals.values()) {
    percentages.push(t.max ? (t.obtained / t.max) * 100 : 0);
  }

  // how many students got each grade
  const gradeCounts = {};
  for (const p of percentages) {
    const grade = gradeFor(p, settings.gradeScale).grade;
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
  }

  const round = (n) => Math.round(n * 100) / 100;
  const count = percentages.length;
  if (count === 0) {
    return ok({ students: 0, average: 0, highest: 0, lowest: 0, passRate: 0, gradeDistribution: [] });
  }
  const sum = percentages.reduce((a, b) => a + b, 0);
  const passed = percentages.filter((p) => p >= settings.passPercentage).length;
  return ok({
    students: count,
    average: round(sum / count),
    highest: round(Math.max(...percentages)),
    lowest: round(Math.min(...percentages)),
    passRate: round((passed / count) * 100),
    gradeDistribution: Object.entries(gradeCounts).map(([grade, n]) => ({ grade, count: n })),
  });
}

/** Results (grades, SGPA, CGPA) of a student. The id 'me' means the logged-in student. */
export async function studentResults(ctx: Ctx) {
  let { id } = ctx.params;
  if (id === 'me') {
    if (ctx.user.role !== 'student') throw AppError.badRequest('Use a student id');
    id = String((await studentProfile(ctx))._id);
  } else {
    requireValidId(id, 'student id');
    await assertStudentAccess(ctx, id);
  }
  const semester = ctx.query.semester ? Number(ctx.query.semester) : undefined;
  // faculty only see results for the subjects they teach
  const subjectIds = ctx.user.role === 'faculty' ? await facultySubjectIds(ctx) : undefined;
  return ok(await computeResults(id, { semester, subjectIds }));
}

export async function remove(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const m = await Mark.findById(ctx.params.id);
  if (!m) throw AppError.notFound('Mark not found');
  await assertSubjectAccess(ctx, m.subject);
  await m.deleteOne();
  await audit(ctx, 'MARKS_DELETED', 'Mark', m._id, { student: m.student, examType: m.examType, marksObtained: m.marksObtained });
  return ok(null, 'Mark deleted');
}
