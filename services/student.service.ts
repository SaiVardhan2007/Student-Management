// Student records: create, update, list, activate/deactivate, photo upload and CSV export.
// Each student also has a linked login account (User) that is kept in sync.
import type { Ctx } from '@/lib/context';
import { Student, User, Department, Program, Section, AcademicYear, Enrollment } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId, escapeRegex, type FilterSpec } from '@/lib/query';
import { studentProfile } from '@/lib/auth';
import { visibleStudentScope, assertStudentAccess } from '@/services/access';
import { syncEnrollments } from '@/services/enrollment';
import { audit } from '@/services/audit';
import { applyUpdate } from '@/services/crud';
import { csvResponse } from '@/lib/csv';
import { toFileMeta, removeFile } from '@/lib/upload';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'program', select: 'name code' },
  { path: 'section', select: 'name' },
  { path: 'academicYear', select: 'name' },
];
const FILTERS: FilterSpec = {
  department: 'id',
  program: 'id',
  section: 'id',
  academicYear: 'id',
  semester: 'number',
  status: 'string',
  batch: 'string',
  admissionYear: 'number',
  gender: 'string',
};

const SEARCH_FIELDS = ['firstName', 'lastName', 'studentId', 'email', 'phone'];

/** Query filter for listing students: URL filters, limited to the students this user may see. */
async function listFilter(ctx) {
  const filter = filtersFromQuery(ctx.query, FILTERS);
  const scope = await visibleStudentScope(ctx);
  if (!scope.all) filter._id = { $in: scope.ids };
  return filter;
}

export async function list(ctx: Ctx) {
  const { items, meta } = await paginate(Student, ctx, {
    filter: await listFilter(ctx),
    searchFields: SEARCH_FIELDS,
    allowedSort: ['firstName', 'lastName', 'studentId', 'semester', 'status', 'admissionYear', 'createdAt'],
    populate: POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function get(ctx: Ctx) {
  requireValidId(ctx.params.id);
  await assertStudentAccess(ctx, ctx.params.id);
  const s = await Student.findById(ctx.params.id).populate(POPULATE).populate('user', 'email isActive lastLoginAt');
  if (!s) throw AppError.notFound('Student not found');
  return ok(s);
}

export async function getMe(ctx: Ctx) {
  const s = await studentProfile(ctx);
  return ok(await Student.findById(s._id).populate(POPULATE));
}

/**
 * Create a student record. No login is created: the student signs up themselves with the admission number and the
 * email stored here (the admin can correct that email later if the student lost access to it).
 */
export async function create(ctx: Ctx) {
  const { password: _ignored, ...data } = ctx.body;
  await assertReferences(data);
  if (await Student.exists({ $or: [{ studentId: data.studentId.toUpperCase() }, { email: data.email }] })) {
    throw AppError.conflict('A student with this Admission number or email already exists');
  }
  if (await User.exists({ email: data.email })) throw AppError.conflict('An account with this email already exists');
  const student = await Student.create(data);
  await syncEnrollments(student);
  await audit(ctx, 'STUDENT_CREATED', 'Student', student._id, { studentId: student.studentId });
  return created({ student }, 'Student created');
}

/** Check that the department/program/section/academic year ids sent by the client really exist. */
async function assertReferences(data) {
  if (data.department && !(await Department.exists({ _id: data.department }))) {
    throw AppError.badRequest('Department not found');
  }
  if (data.program) {
    const program = await Program.findOne({ _id: data.program }).select('department');
    if (!program) throw AppError.badRequest('Program not found');
    if (data.department && String(program.department) !== String(data.department)) {
      throw AppError.badRequest('Program does not belong to the selected department');
    }
  }
  if (data.section && !(await Section.exists({ _id: data.section }))) {
    throw AppError.badRequest('Section not found');
  }
  if (data.academicYear && !(await AcademicYear.exists({ _id: data.academicYear }))) {
    throw AppError.badRequest('Academic year not found');
  }
}

export async function update(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const student = await Student.findById(ctx.params.id);
  if (!student) throw AppError.notFound('Student not found');
  // validate the merged document so a partial update cannot pair a program with another department
  if (['department', 'program', 'section', 'academicYear'].some((k) => ctx.body[k] !== undefined))
    await assertReferences({
      department: student.department,
      program: student.program,
      section: student.section,
      academicYear: student.academicYear,
      ...ctx.body,
    });
  const changed = Object.keys(ctx.body);
  const oldStatus = student.status;
  // if program, semester or section changed, the student's subject enrollments must be recalculated
  const progressed = ['program', 'semester', 'section'].some((field) => {
    const newValue = ctx.body[field];
    return newValue !== undefined && String(newValue) !== String(student[field]);
  });
  // the email is also the login: make sure nobody else (student or any account) uses it before saving anything
  if (ctx.body.email && ctx.body.email !== student.email) {
    const [studentClash, userClash] = await Promise.all([
      Student.exists({ email: ctx.body.email, _id: { $ne: student._id } }),
      User.exists({ email: ctx.body.email, ...(student.user ? { _id: { $ne: student.user } } : {}) }),
    ]);
    if (studentClash || userClash)
      throw AppError.conflict('An account with this email already exists', [{ field: 'email', message: 'Already exists' }]);
  }
  applyUpdate(student, ctx.body);
  await student.save();

  // keep the linked login account (name, email, active flag) in sync
  const userUpdate: Record<string, any> = {};
  if (ctx.body.email || ctx.body.firstName || ctx.body.lastName) {
    userUpdate.name = `${student.firstName} ${student.lastName}`;
    userUpdate.email = student.email;
  }
  if (ctx.body.status && ctx.body.status !== oldStatus) userUpdate.isActive = student.status === 'active';
  if (Object.keys(userUpdate).length && student.user) await User.updateOne({ _id: student.user }, userUpdate);
  if (progressed) await syncEnrollments(student);

  await audit(ctx, 'STUDENT_UPDATED', 'Student', student._id, { fields: changed });
  return ok(student, 'Student updated');
}

export async function updateMe(ctx: Ctx) {
  const s = await studentProfile(ctx);
  s.set(ctx.body);
  await s.save();
  await audit(ctx, 'STUDENT_PROFILE_UPDATED', 'Student', s._id, { fields: Object.keys(ctx.body) });
  return ok(s, 'Profile updated');
}

/** Soft delete: mark inactive and disable the login. */
export async function deactivate(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const s = await Student.findById(ctx.params.id);
  if (!s) throw AppError.notFound('Student not found');
  s.status = 'inactive';
  await s.save();
  if (s.user) await User.updateOne({ _id: s.user }, { isActive: false });
  await audit(ctx, 'STUDENT_DEACTIVATED', 'Student', s._id);
  return ok(s, 'Student deactivated');
}

export async function activate(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const s = await Student.findById(ctx.params.id);
  if (!s) throw AppError.notFound('Student not found');
  s.status = 'active';
  await s.save();
  if (s.user) await User.updateOne({ _id: s.user }, { isActive: true });
  await audit(ctx, 'STUDENT_ACTIVATED', 'Student', s._id);
  return ok(s, 'Student activated');
}

/** Upload a profile photo. Students may only change their own ('me'). */
export async function uploadPhoto(ctx: Ctx) {
  if (!ctx.file) throw AppError.badRequest('Please choose an image file');
  const s =
    ctx.user.role === 'student' && ctx.params.id === 'me'
      ? await studentProfile(ctx)
      : await Student.findById(requireValidId(ctx.params.id));
  if (!s) throw AppError.notFound('Student not found');
  if (ctx.user.role === 'student' && String(s.user) !== String(ctx.user._id)) throw AppError.forbidden();
  removeFile(s.photo);
  s.photo = toFileMeta(ctx.file, 'photos').path;
  await s.save();
  return ok({ photo: s.photo }, 'Photo updated');
}

export async function exportCsv(ctx: Ctx) {
  const filter = await listFilter(ctx);
  // same search as the list, so the export matches what is on screen
  if (ctx.query.search) {
    const rx = new RegExp(escapeRegex(String(ctx.query.search).slice(0, 80)), 'i');
    filter.$and = [...(filter.$and || []), { $or: SEARCH_FIELDS.map((f) => ({ [f]: rx })) }];
  }
  const rows = await Student.find(filter).sort({ studentId: 1 }).limit(20000).populate(POPULATE).lean();
  return csvResponse('students.csv', rows, [
    { label: 'Student ID', value: 'studentId' },
    { label: 'First Name', value: 'firstName' },
    { label: 'Last Name', value: 'lastName' },
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    { label: 'Department', value: (r) => r.department?.name },
    { label: 'Program', value: (r) => r.program?.name },
    { label: 'Section', value: (r) => r.section?.name },
    { label: 'Semester', value: 'semester' },
    { label: 'Batch', value: 'batch' },
    { label: 'Admission Year', value: 'admissionYear' },
    { label: 'Status', value: 'status' },
  ]);
}

export async function enrollments(ctx: Ctx) {
  requireValidId(ctx.params.id);
  await assertStudentAccess(ctx, ctx.params.id);
  const items = await Enrollment.find({ student: ctx.params.id })
    .populate({ path: 'subject', select: 'code name credits type semester', populate: { path: 'faculty', select: 'firstName lastName' } })
    .lean();
  return ok(items);
}
