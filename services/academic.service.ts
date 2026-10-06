import * as M from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { facultyProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { crud } from '@/services/crud';
import { studentSubjectIds } from '@/services/access';
import { enrollStudentsInSubject, syncEnrollments } from '@/services/enrollment';

/** keep a single "current" academic year / semester */
const single = (Model: any, field: string) => async (_ctx: Ctx, doc: any) => {
  if (doc[field]) await Model.updateMany({ _id: { $ne: doc._id } }, { [field]: false });
};

export const departments = crud({
  Model: M.Department,
  entity: 'Department',
  searchFields: ['name', 'code'],
  filterSpec: { isActive: 'bool' },
  allowedSort: ['name', 'code'],
  defaultSort: { name: 1 },
  populate: { path: 'head', select: 'firstName lastName' },
  dependents: [
    { Model: M.Program, field: 'department', label: 'program(s)' },
    { Model: M.Student, field: 'department', label: 'student(s)' },
    { Model: M.Faculty, field: 'department', label: 'faculty member(s)' },
    { Model: M.Subject, field: 'department', label: 'subject(s)' },
  ],
});

export const programs = crud({
  Model: M.Program,
  entity: 'Program',
  searchFields: ['name', 'code'],
  filterSpec: { department: 'id', isActive: 'bool' },
  allowedSort: ['name', 'code'],
  defaultSort: { name: 1 },
  populate: { path: 'department', select: 'name code' },
  dependents: [
    { Model: M.Student, field: 'program', label: 'student(s)' },
    { Model: M.Subject, field: 'program', label: 'subject(s)' },
    { Model: M.Section, field: 'program', label: 'section(s)' },
  ],
  beforeCreate: async (ctx) => {
    if (!(await M.Department.exists({ _id: ctx.body.department }))) throw AppError.badRequest('Department not found');
  },
});

export const academicYears = crud({
  Model: M.AcademicYear,
  entity: 'AcademicYear',
  searchFields: ['name'],
  filterSpec: { isCurrent: 'bool' },
  allowedSort: ['name', 'startDate'],
  defaultSort: { startDate: -1 },
  afterCreate: single(M.AcademicYear, 'isCurrent'),
  afterUpdate: single(M.AcademicYear, 'isCurrent'),
  dependents: [{ Model: M.Semester, field: 'academicYear', label: 'semester(s)' }],
});

export const semesters = crud({
  Model: M.Semester,
  entity: 'Semester',
  searchFields: ['name'],
  filterSpec: { academicYear: 'id', isCurrent: 'bool', number: 'number' },
  allowedSort: ['number', 'startDate'],
  defaultSort: { startDate: -1 },
  populate: { path: 'academicYear', select: 'name' },
  afterCreate: single(M.Semester, 'isCurrent'),
  afterUpdate: single(M.Semester, 'isCurrent'),
});

export const sections = crud({
  Model: M.Section,
  entity: 'Section',
  searchFields: ['name', 'batch'],
  filterSpec: { program: 'id', department: 'id', semester: 'number', batch: 'string', isActive: 'bool' },
  allowedSort: ['name', 'semester'],
  defaultSort: { name: 1 },
  populate: [
    { path: 'program', select: 'name code' },
    { path: 'department', select: 'name code' },
  ],
  dependents: [
    { Model: M.Student, field: 'section', label: 'student(s)' },
    { Model: M.Timetable, field: 'section', label: 'timetable slot(s)' },
  ],
});

async function checkSubjectRefs(b: Record<string, any>) {
  if (b.faculty && !(await M.Faculty.exists({ _id: b.faculty }))) throw AppError.badRequest('Faculty not found');
  if (b.program) {
    const p = await M.Program.findById(b.program);
    if (!p) throw AppError.badRequest('Program not found');
    if (b.department && String(p.department) !== String(b.department))
      throw AppError.badRequest('Program does not belong to the selected department');
  }
}

export const subjects = crud({
  Model: M.Subject,
  entity: 'Subject',
  searchFields: ['name', 'code'],
  filterSpec: { department: 'id', program: 'id', semester: 'number', type: 'string', faculty: 'id', isActive: 'bool' },
  allowedSort: ['name', 'code', 'semester', 'credits'],
  defaultSort: { code: 1 },
  populate: [
    { path: 'department', select: 'name code' },
    { path: 'program', select: 'name code' },
    { path: 'faculty', select: 'firstName lastName employeeId' },
    { path: 'sections', select: 'name' },
  ],
  scope: async (ctx) => {
    if (ctx.query.mine !== 'true') return {};
    if (ctx.user.role === 'faculty') return { faculty: (await facultyProfile(ctx))._id };
    if (ctx.user.role === 'student') return { _id: { $in: await studentSubjectIds(ctx) } };
    return {};
  },
  beforeCreate: async (ctx) => checkSubjectRefs(ctx.body),
  beforeUpdate: async (ctx) => checkSubjectRefs(ctx.body),
  afterCreate: async (_ctx, doc) => enrollStudentsInSubject(doc, M.Student),
  dependents: [
    { Model: M.Attendance, field: 'subject', label: 'attendance record(s)' },
    { Model: M.Mark, field: 'subject', label: 'mark(s)' },
    { Model: M.Timetable, field: 'subject', label: 'timetable slot(s)' },
    { Model: M.Exam, field: 'subject', label: 'exam(s)' },
  ],
  beforeDelete: async (_ctx, doc) => M.Enrollment.deleteMany({ subject: doc._id }),
});

// (re)build enrolments for one subject
export async function syncSubjectEnrollments(ctx: Ctx) {
  const s = await M.Subject.findById(ctx.params.id);
  if (!s) throw AppError.notFound('Subject not found');
  return ok({ enrolled: await enrollStudentsInSubject(s, M.Student) }, 'Enrollments synced');
}

// (re)build enrolments for every active student
export async function syncAllEnrollments() {
  const students = await M.Student.find({ status: 'active' });
  let n = 0;
  for (const s of students) n += await syncEnrollments(s);
  return ok({ created: n }, 'Enrollments synced');
}

/** Elective enrolment management. */
export async function listEnrollments(ctx: Ctx) {
  const { subject } = ctx.query;
  if (!subject) throw AppError.badRequest('subject is required');
  const items = await M.Enrollment.find({ subject }).populate('student', 'studentId firstName lastName section').lean();
  return ok(items);
}

export async function enrollStudent(ctx: Ctx) {
  const [student, subject] = await Promise.all([M.Student.findById(ctx.body.student), M.Subject.findById(ctx.body.subject)]);
  if (!student || !subject) throw AppError.notFound('Student or subject not found');
  const e = await M.Enrollment.findOneAndUpdate(
    { student: student._id, subject: subject._id },
    { $set: { status: 'enrolled', semester: subject.semester } },
    { upsert: true, new: true }
  );
  return ok(e, 'Student enrolled', 201);
}

export async function dropEnrollment(ctx: Ctx) {
  const e = await M.Enrollment.findByIdAndUpdate(ctx.params.id, { status: 'dropped' }, { new: true });
  if (!e) throw AppError.notFound('Enrollment not found');
  return ok(e, 'Enrollment dropped');
}
