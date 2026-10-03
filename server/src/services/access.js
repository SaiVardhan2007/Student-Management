import { Subject, Enrollment, Student } from '../models/index.js';
import { facultyProfile, studentProfile } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

/** Subject ids a faculty member teaches. */
export async function facultySubjectIds(req) {
  const f = await facultyProfile(req);
  const subjects = await Subject.find({ faculty: f._id }).select('_id').lean();
  return subjects.map((s) => s._id);
}

/** Throws unless admin, or the faculty user teaches the subject. Returns the subject. */
export async function assertSubjectAccess(req, subjectId) {
  const subject = await Subject.findById(subjectId);
  if (!subject) throw AppError.notFound('Subject not found');
  if (req.user.role === 'admin') return subject;
  if (req.user.role !== 'faculty') throw AppError.forbidden();
  const f = await facultyProfile(req);
  if (String(subject.faculty) !== String(f._id)) {
    throw AppError.forbidden('You are not assigned to this subject');
  }
  return subject;
}

/** Subject ids visible to a student (their enrolments). */
export async function studentSubjectIds(req) {
  const s = await studentProfile(req);
  const en = await Enrollment.find({ student: s._id, status: { $ne: 'dropped' } }).select('subject').lean();
  return en.map((e) => e.subject);
}

/**
 * Resolve which Student documents a request may act on:
 * - student: themself; parent: linked children; faculty: students enrolled in their subjects; admin: any.
 * Returns { all: true } for admin, else { ids: [...] }.
 */
export async function visibleStudentScope(req) {
  const { role } = req.user;
  if (role === 'admin') return { all: true };
  if (role === 'student') return { ids: [(await studentProfile(req))._id] };
  if (role === 'parent') return { ids: req.user.children || [] };
  if (role === 'faculty') {
    const subjectIds = await facultySubjectIds(req);
    const ids = await Enrollment.distinct('student', { subject: { $in: subjectIds } });
    return { ids };
  }
  return { ids: [] };
}

export async function assertStudentAccess(req, studentId) {
  const scope = await visibleStudentScope(req);
  if (scope.all) return;
  if (!scope.ids.some((id) => String(id) === String(studentId))) throw AppError.forbidden('You cannot access this student');
}

/** For student/parent users, the student ids they are allowed to view marks/attendance for. */
export async function ownStudentIds(req) {
  if (req.user.role === 'student') return [(await studentProfile(req))._id];
  if (req.user.role === 'parent') return req.user.children || [];
  return [];
}

export { Student };
