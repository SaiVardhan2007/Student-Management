import { Enrollment, Subject } from '../models/index.js';

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
  if (!subjects.length) return 0;
  const ops = subjects.map((s) => ({
    updateOne: {
      filter: { student: student._id, subject: s._id },
      update: { $setOnInsert: { student: student._id, subject: s._id, semester: student.semester, status: 'enrolled' } },
      upsert: true,
    },
  }));
  const res = await Enrollment.bulkWrite(ops, { ordered: false });
  return res.upsertedCount;
}

/** Enrol all active students of a program+semester in a newly created subject. */
export async function enrollStudentsInSubject(subject, Student) {
  if (subject.type === 'elective') return 0;
  const filter = { program: subject.program, semester: subject.semester, status: 'active' };
  if (subject.sections?.length) filter.section = { $in: subject.sections };
  const students = await Student.find(filter).select('_id').lean();
  if (!students.length) return 0;
  const res = await Enrollment.bulkWrite(
    students.map((s) => ({
      updateOne: {
        filter: { student: s._id, subject: subject._id },
        update: { $setOnInsert: { student: s._id, subject: subject._id, semester: subject.semester, status: 'enrolled' } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return res.upsertedCount;
}
