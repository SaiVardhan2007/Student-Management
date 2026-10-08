// Creates Enrollment records (which student takes which subject).
import { Enrollment, Subject } from '@/models';

// Add an 'enrolled' record for each (student, subject) pair unless it already exists.
// Returns how many new records were created.
async function enrollPairs(pairs: { studentId: any; subjectId: any; semester: number }[]) {
  const operations = pairs.map((pair) => ({
    updateOne: {
      filter: { student: pair.studentId, subject: pair.subjectId },
      update: { $setOnInsert: { student: pair.studentId, subject: pair.subjectId, semester: pair.semester, status: 'enrolled' } },
      upsert: true,
    },
  }));
  const result = await Enrollment.bulkWrite(operations, { ordered: false });
  return result.upsertedCount;
}

/**
 * Enrol a student into all non-elective subjects of their program + semester
 * (respecting subject.sections when set). Idempotent.
 */
export async function syncEnrollments(student) {
  if (!student.program || !student.semester) return 0;
  const subjects = await Subject.find({
    program: student.program,
    semester: student.semester,
    type: { $ne: 'elective' },
    isActive: true,
    $or: [{ sections: { $size: 0 } }, { sections: student.section }],
  })
    .select('_id')
    .lean();
  await closeStaleEnrollments(student);
  if (!subjects.length) return 0;
  return enrollPairs(subjects.map((s) => ({ studentId: student._id, subjectId: s._id, semester: student.semester })));
}

// A non-elective subject still fits a student when program, semester and (if limited) section all match.
const subjectFits = (subject, student) =>
  String(subject.program) === String(student.program) &&
  subject.semester === student.semester &&
  (!subject.sections?.length || subject.sections.some((id) => String(id) === String(student.section)));

/**
 * After a program/semester/section change, close 'enrolled' records of non-elective subjects that no longer fit:
 * 'completed' for earlier semesters of the same program, otherwise 'dropped'. Electives are left alone.
 */
async function closeStaleEnrollments(student) {
  const current = await Enrollment.find({ student: student._id, status: 'enrolled' }).populate('subject', 'program semester sections type').lean<any[]>();
  const done = [];
  const dropped = [];
  for (const e of current) {
    const subject = e.subject;
    if (!subject || subject.type === 'elective' || subjectFits(subject, student)) continue;
    const earlier = String(subject.program) === String(student.program) && subject.semester < student.semester;
    (earlier ? done : dropped).push(e._id);
  }
  if (done.length) await Enrollment.updateMany({ _id: { $in: done } }, { status: 'completed' });
  if (dropped.length) await Enrollment.updateMany({ _id: { $in: dropped } }, { status: 'dropped' });
}

/** Enrol all active students of a program+semester in a newly created subject. */
function studentsOfSubjectFilter(subject): Record<string, any> {
  const filter: Record<string, any> = { program: subject.program, semester: subject.semester };
  if (subject.sections?.length) filter.section = { $in: subject.sections };
  return filter;
}

/** After a subject's program/semester/sections change, drop 'enrolled' records of students who no longer belong to it. */
export async function dropStaleSubjectEnrollments(subject, Student) {
  if (subject.type === 'elective') return 0;
  const fitting = await Student.find(studentsOfSubjectFilter(subject)).select('_id').lean();
  const res = await Enrollment.updateMany(
    { subject: subject._id, status: 'enrolled', student: { $nin: fitting.map((s) => s._id) } },
    { status: 'dropped' }
  );
  return res.modifiedCount;
}

export async function enrollStudentsInSubject(subject, Student) {
  if (subject.type === 'elective') return 0;
  const filter = { ...studentsOfSubjectFilter(subject), status: 'active' };
  const students = await Student.find(filter).select('_id').lean();
  if (!students.length) return 0;
  return enrollPairs(students.map((s) => ({ studentId: s._id, subjectId: subject._id, semester: subject.semester })));
}
