import { Student, User, Department, Program, Section, AcademicYear, Enrollment } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { studentProfile } from '../middleware/auth.js';
import { visibleStudentScope, assertStudentAccess } from '../services/access.js';
import { createAccount } from '../services/accounts.js';
import { syncEnrollments } from '../services/enrollment.js';
import { audit } from '../services/audit.js';
import { sendCsv } from '../utils/csv.js';
import { toFileMeta, removeFile } from '../middleware/upload.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'program', select: 'name code' },
  { path: 'section', select: 'name' },
  { path: 'academicYear', select: 'name' },
];
const FILTERS = { department: 'id', program: 'id', section: 'id', academicYear: 'id', semester: 'number', status: 'string', batch: 'string', admissionYear: 'number', gender: 'string' };

async function listFilter(req) {
  const filter = filtersFromQuery(req.query, FILTERS);
  const scope = await visibleStudentScope(req);
  if (!scope.all) filter._id = { $in: scope.ids };
  return filter;
}

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await paginate(Student, req, {
    filter: await listFilter(req),
    searchFields: ['firstName', 'lastName', 'studentId', 'email', 'phone'],
    allowedSort: ['firstName', 'lastName', 'studentId', 'semester', 'status', 'admissionYear'],
    populate: POPULATE,
  });
  ok(res, items, 'OK', 200, meta);
});

export const get = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  await assertStudentAccess(req, req.params.id);
  const s = await Student.findById(req.params.id).populate(POPULATE).populate('user', 'email isActive lastLoginAt');
  if (!s) throw AppError.notFound('Student not found');
  ok(res, s);
});

export const getMe = asyncHandler(async (req, res) => {
  const s = await studentProfile(req);
  ok(res, await Student.findById(s._id).populate(POPULATE));
});

export const create = asyncHandler(async (req, res) => {
  const { password, ...data } = req.body;
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
  await audit(req, 'STUDENT_CREATED', 'Student', student._id, { studentId: student.studentId });
  created(res, { student, temporaryPassword }, 'Student created');
});

async function assertReferences(data) {
  const checks = [];
  if (data.department) checks.push(Department.exists({ _id: data.department }).then((x) => x || Promise.reject(AppError.badRequest('Department not found'))));
  if (data.program) checks.push(Program.findOne({ _id: data.program }).select('department').then((p) => {
    if (!p) throw AppError.badRequest('Program not found');
    if (data.department && String(p.department) !== String(data.department)) throw AppError.badRequest('Program does not belong to the selected department');
  }));
  if (data.section) checks.push(Section.exists({ _id: data.section }).then((x) => x || Promise.reject(AppError.badRequest('Section not found'))));
  if (data.academicYear) checks.push(AcademicYear.exists({ _id: data.academicYear }).then((x) => x || Promise.reject(AppError.badRequest('Academic year not found'))));
  await Promise.all(checks);
}

export const update = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const student = await Student.findById(req.params.id);
  if (!student) throw AppError.notFound('Student not found');
  await assertReferences({ ...req.body, department: req.body.department, program: req.body.program });
  const changed = Object.keys(req.body);
  const oldStatus = student.status;
  const progressed = ['program', 'semester', 'section'].some((k) => req.body[k] !== undefined && String(req.body[k]) !== String(student[k]));
  student.set(req.body);
  await student.save();

  // keep the login account in sync
  const userUpdate = {};
  if (req.body.email || req.body.firstName || req.body.lastName) {
    userUpdate.name = `${student.firstName} ${student.lastName}`;
    userUpdate.email = student.email;
  }
  if (req.body.status && req.body.status !== oldStatus) userUpdate.isActive = student.status === 'active';
  if (Object.keys(userUpdate).length && student.user) await User.updateOne({ _id: student.user }, userUpdate);
  if (progressed) await syncEnrollments(student);

  await audit(req, 'STUDENT_UPDATED', 'Student', student._id, { fields: changed });
  ok(res, student, 'Student updated');
});

export const updateMe = asyncHandler(async (req, res) => {
  const s = await studentProfile(req);
  s.set(req.body);
  await s.save();
  await audit(req, 'STUDENT_PROFILE_UPDATED', 'Student', s._id, { fields: Object.keys(req.body) });
  ok(res, s, 'Profile updated');
});

/** Soft delete: mark inactive and disable the login. */
export const deactivate = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const s = await Student.findById(req.params.id);
  if (!s) throw AppError.notFound('Student not found');
  s.status = 'inactive';
  await s.save();
  if (s.user) await User.updateOne({ _id: s.user }, { isActive: false });
  await audit(req, 'STUDENT_DEACTIVATED', 'Student', s._id);
  ok(res, s, 'Student deactivated');
});

export const activate = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const s = await Student.findById(req.params.id);
  if (!s) throw AppError.notFound('Student not found');
  s.status = 'active';
  await s.save();
  if (s.user) await User.updateOne({ _id: s.user }, { isActive: true });
  await audit(req, 'STUDENT_ACTIVATED', 'Student', s._id);
  ok(res, s, 'Student activated');
});

export const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('Please choose an image file');
  const s = req.user.role === 'student' && req.params.id === 'me' ? await studentProfile(req) : await Student.findById(requireValidId(req.params.id));
  if (!s) throw AppError.notFound('Student not found');
  if (req.user.role === 'student' && String(s.user) !== String(req.user._id)) throw AppError.forbidden();
  removeFile(s.photo);
  s.photo = toFileMeta(req.file, 'photos').path;
  await s.save();
  ok(res, { photo: s.photo }, 'Photo updated');
});

export const exportCsv = asyncHandler(async (req, res) => {
  const filter = await listFilter(req);
  const rows = await Student.find(filter).sort({ studentId: 1 }).limit(20000).populate(POPULATE).lean();
  sendCsv(res, 'students.csv', rows, [
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
});

export const enrollments = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  await assertStudentAccess(req, req.params.id);
  const items = await Enrollment.find({ student: req.params.id }).populate({ path: 'subject', select: 'code name credits type semester', populate: { path: 'faculty', select: 'firstName lastName' } }).lean();
  ok(res, items);
});

