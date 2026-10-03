import { Student, Subject, Section, Enrollment } from '../models/index.js';
import { facultyProfile, studentProfile } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

/** Student docs relevant to the current student/parent user. */
export async function ownStudents(req) {
  if (req.user.role === 'student') return [await studentProfile(req)];
  if (req.user.role === 'parent') return Student.find({ _id: { $in: req.user.children || [] } });
  return [];
}

/** Does this faculty member teach the given section? (used for class-level notices) */
export async function facultyTeachesSection(req, sectionId) {
  const f = await facultyProfile(req);
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
export async function visibleSubjectIds(req) {
  const { role } = req.user;
  if (role === 'admin') return null; // null = unrestricted
  if (role === 'faculty') {
    const f = await facultyProfile(req);
    return (await Subject.find({ faculty: f._id }).select('_id').lean()).map((s) => s._id);
  }
  const students = await ownStudents(req);
  return Enrollment.distinct('subject', { student: { $in: students.map((s) => s._id) }, status: { $ne: 'dropped' } });
}

export const yearOfSemester = (sem) => Math.ceil(sem / 2);
