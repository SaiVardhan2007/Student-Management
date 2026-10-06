import type { Ctx } from '@/lib/context';
import { Student, User, Department, Program, Section, AcademicYear, Enrollment } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId, type FilterSpec } from '@/lib/query';
import { studentProfile } from '@/lib/auth';
import { visibleStudentScope, assertStudentAccess } from '@/services/access';
import { createAccount } from '@/services/accounts';
import { syncEnrollments } from '@/services/enrollment';
import { audit } from '@/services/audit';
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

async function listFilter(ctx) {
  const filter = filtersFromQuery(ctx.query, FILTERS);
  const scope = await visibleStudentScope(ctx);
  if (!scope.all) filter._id = { $in: scope.ids };
  return filter;
}

export async function list(ctx: Ctx) {
  const { items, meta } = await paginate(Student, ctx, {
    filter: await listFilter(ctx),
    searchFields: ['firstName', 'lastName', 'studentId', 'email', 'phone'],
    allowedSort: ['firstName', 'lastName', 'studentId', 'semester', 'status', 'admissionYear'],
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

export async function create(ctx: Ctx) {
  const { password, ...data } = ctx.body;
  await assertReferences(data);
  if (await Student.exists({ $or: [{ studentId: data.studentId.toUpperCase() }, { email: data.email }] })) {
    throw AppError.conflict('A student with this Student ID or email already exists');
  }
  const { user, temporaryPassword } = await createAccount({
    name: `${data.firstName} ${data.lastName}`,
    email: data.email,
    role: 'student',
    password,
  });
  let student;
  try {
    student = await Student.create({ ...data, user: user._id });
  } catch (err) {
    await User.deleteOne({ _id: user._id }); // no orphan accounts
    throw err;
  }
  await syncEnrollments(student);
  await audit(ctx, 'STUDENT_CREATED', 'Student', student._id, { studentId: student.studentId });
  return created({ student, temporaryPassword }, 'Student created');
}

async function assertReferences(data) {
  const checks = [];
  if (data.department)
    checks.push(Department.exists({ _id: data.department }).then((x) => x || Promise.reject(AppError.badRequest('Department not found'))));
  if (data.program)
    checks.push(
      Program.findOne({ _id: data.program })
        .select('department')
        .then((p) => {
          if (!p) throw AppError.badRequest('Program not found');
          if (data.department && String(p.department) !== String(data.department))
            throw AppError.badRequest('Program does not belong to the selected department');
        })
    );
  if (data.section)
    checks.push(Section.exists({ _id: data.section }).then((x) => x || Promise.reject(AppError.badRequest('Section not found'))));
  if (data.academicYear)
    checks.push(
      AcademicYear.exists({ _id: data.academicYear }).then((x) => x || Promise.reject(AppError.badRequest('Academic year not found')))
    );
  await Promise.all(checks);
}

export async function update(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const student = await Student.findById(ctx.params.id);
  if (!student) throw AppError.notFound('Student not found');
  await assertReferences({ ...ctx.body, department: ctx.body.department, program: ctx.body.program });
  const changed = Object.keys(ctx.body);
  const oldStatus = student.status;
  const progressed = ['program', 'semester', 'section'].some(
    (k) => ctx.body[k] !== undefined && String(ctx.body[k]) !== String(student[k])
  );
  student.set(ctx.body);
  await student.save();

  // keep the login account in sync
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
