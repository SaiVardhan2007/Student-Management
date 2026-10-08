// Helpers that decide which subjects / students the logged-in user may see.
// Services call these before reading or changing data.
import type { Ctx } from '@/lib/context';
import { Subject, Enrollment, Student } from '@/models';
import { facultyProfile, studentProfile } from '@/lib/auth';
import { AppError } from '@/lib/errors';

/** Subject ids a faculty member teaches. */
export async function facultySubjectIds(ctx: Ctx) {
  const faculty = await facultyProfile(ctx);
  const subjects = await Subject.find({ faculty: faculty._id }).select('_id').lean();
  return subjects.map((s) => s._id);
}

/** Throws unless admin, or the faculty user teaches the subject. Returns the subject. */
export async function assertSubjectAccess(ctx: Ctx, subjectId) {
  const subject = await Subject.findById(subjectId);
  if (!subject) throw AppError.notFound('Subject not found');
  if (ctx.user.role === 'admin') return subject;
  if (ctx.user.role !== 'faculty') throw AppError.forbidden();
  const faculty = await facultyProfile(ctx);
  if (String(subject.faculty) !== String(faculty._id)) {
    throw AppError.forbidden('You are not assigned to this subject');
  }
  return subject;
}

/** Subject ids visible to a student (their enrolments). */
export async function studentSubjectIds(ctx: Ctx) {
  const student = await studentProfile(ctx);
  const enrollments = await Enrollment.find({ student: student._id, status: { $ne: 'dropped' } })
    .select('subject')
    .lean();
  return enrollments.map((e) => e.subject);
}

/**
 * Resolve which Student documents a request may act on:
 * - student: themself; parent: linked children; faculty: students enrolled in their subjects; admin: any.
 * Returns { all: true } for admin, else { ids: [...] }.
 */
export async function visibleStudentScope(ctx: Ctx) {
  const { role } = ctx.user;
  if (role === 'admin') return { all: true };
  if (role === 'student') return { ids: [(await studentProfile(ctx))._id] };
  if (role === 'parent') return { ids: ctx.user.children || [] };
  if (role === 'faculty') {
    const subjectIds = await facultySubjectIds(ctx);
    const ids = await Enrollment.distinct('student', { subject: { $in: subjectIds }, status: 'enrolled' });
    return { ids };
  }
  return { ids: [] };
}

/** Throws unless the user is allowed to access this student. */
export async function assertStudentAccess(ctx: Ctx, studentId) {
  const scope = await visibleStudentScope(ctx);
  if (scope.all) return;
  if (!scope.ids.some((id) => String(id) === String(studentId))) throw AppError.forbidden('You cannot access this student');
}

/** For student/parent users, the student ids they are allowed to view marks/attendance for. */
export async function ownStudentIds(ctx: Ctx) {
  if (ctx.user.role === 'student') return [(await studentProfile(ctx))._id];
  if (ctx.user.role === 'parent') return ctx.user.children || [];
  return [];
}

export { Student };
