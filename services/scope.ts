import type { Ctx } from '@/lib/context';
import { Student, Subject, Section, Enrollment } from '@/models';
import { facultyProfile, studentProfile } from '@/lib/auth';
import { AppError } from '@/lib/errors';

/** Student docs relevant to the current student/parent user. */
export async function ownStudents(ctx: Ctx) {
  if (ctx.user.role === 'student') return [await studentProfile(ctx)];
  if (ctx.user.role === 'parent') return Student.find({ _id: { $in: ctx.user.children || [] } });
  return [];
}

/** Does this faculty member teach the given section? (used for class-level notices) */
export async function facultyTeachesSection(ctx: Ctx, sectionId) {
  const f = await facultyProfile(ctx);
  const section = await Section.findById(sectionId);
  if (!section) throw AppError.badRequest('Section not found');
  return !!(await Subject.exists({
    faculty: f._id,
    program: section.program,
    semester: section.semester,
    $or: [{ sections: { $size: 0 } }, { sections: section._id }],
  }));
}

/** Subjects visible for reading content (assignments/materials) by role. */
export async function visibleSubjectIds(ctx: Ctx) {
  const { role } = ctx.user;
  if (role === 'admin') return null; // null = unrestricted
  if (role === 'faculty') {
    const f = await facultyProfile(ctx);
    return (await Subject.find({ faculty: f._id }).select('_id').lean()).map((s) => s._id);
  }
  const students = await ownStudents(ctx);
  return Enrollment.distinct('subject', { student: { $in: students.map((s) => s._id) }, status: { $ne: 'dropped' } });
}

export const yearOfSemester = (sem) => Math.ceil(sem / 2);
