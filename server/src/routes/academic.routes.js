import { Router } from 'express';
import { protect, authorize, facultyProfile } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { crud } from '../controllers/crud.js';
import { asyncHandler, ok } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import * as M from '../models/index.js';
import * as V from '../validators/academic.js';
import { studentSubjectIds } from '../services/access.js';
import { enrollStudentsInSubject, syncEnrollments } from '../services/enrollment.js';

const admin = authorize('admin');

// zod refinements (ZodEffects) have no .partial(); unwrap for PATCH/PUT
const partial = (s) => (s._def.schema ? s._def.schema.partial() : s.partial());

const single = (Model, field) => async (_req, doc) => {
  if (doc[field]) await Model.updateMany({ _id: { $ne: doc._id } }, { [field]: false });
};

const departments = crud({
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

const programs = crud({
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
  beforeCreate: async (req) => {
    if (!(await M.Department.exists({ _id: req.body.department }))) throw AppError.badRequest('Department not found');
  },
});

const years = crud({
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

const semesters = crud({
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

const sections = crud({
  Model: M.Section,
  entity: 'Section',
  searchFields: ['name', 'batch'],
  filterSpec: { program: 'id', department: 'id', semester: 'number', batch: 'string', isActive: 'bool' },
  allowedSort: ['name', 'semester'],
  defaultSort: { name: 1 },
  populate: [{ path: 'program', select: 'name code' }, { path: 'department', select: 'name code' }],
  dependents: [
    { Model: M.Student, field: 'section', label: 'student(s)' },
    { Model: M.Timetable, field: 'section', label: 'timetable slot(s)' },
  ],
});

const subjects = crud({
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
  scope: async (req) => {
    if (req.query.mine !== 'true') return {};
    if (req.user.role === 'faculty') return { faculty: (await facultyProfile(req))._id };
    if (req.user.role === 'student') return { _id: { $in: await studentSubjectIds(req) } };
    return {};
  },
  beforeCreate: async (req) => checkSubjectRefs(req.body),
  beforeUpdate: async (req) => checkSubjectRefs(req.body),
  afterCreate: async (_req, doc) => enrollStudentsInSubject(doc, M.Student),
  dependents: [
    { Model: M.Attendance, field: 'subject', label: 'attendance record(s)' },
    { Model: M.Mark, field: 'subject', label: 'mark(s)' },
    { Model: M.Timetable, field: 'subject', label: 'timetable slot(s)' },
    { Model: M.Exam, field: 'subject', label: 'exam(s)' },
  ],
  beforeDelete: async (_req, doc) => M.Enrollment.deleteMany({ subject: doc._id }),
});

async function checkSubjectRefs(b) {
  if (b.faculty && !(await M.Faculty.exists({ _id: b.faculty }))) throw AppError.badRequest('Faculty not found');
  if (b.program) {
    const p = await M.Program.findById(b.program);
    if (!p) throw AppError.badRequest('Program not found');
    if (b.department && String(p.department) !== String(b.department)) throw AppError.badRequest('Program does not belong to the selected department');
  }
}

const router = Router();
router.use(protect);

const wire = (path, ctl, schema, extra) => {
  const r = Router();
  r.get('/', ctl.list);
  r.get('/:id', ctl.get);
  r.post('/', admin, validate(schema), ctl.create);
  r.put('/:id', admin, validate(partial(schema)), ctl.update);
  r.patch('/:id', admin, validate(partial(schema)), ctl.update);
  r.delete('/:id', admin, ctl.remove);
  if (extra) extra(r);
  router.use(path, r);
};

wire('/departments', departments, V.departmentSchema);
wire('/programs', programs, V.programSchema);
wire('/academic-years', years, V.academicYearSchema);
wire('/semesters', semesters, V.semesterSchema);
wire('/sections', sections, V.sectionSchema);
wire('/subjects', subjects, V.subjectSchema, (r) => {
  // (re)build enrolments for one subject or all students of a program/semester
  r.post('/:id/sync-enrollments', admin, asyncHandler(async (req, res) => {
    const s = await M.Subject.findById(req.params.id);
    if (!s) throw AppError.notFound('Subject not found');
    ok(res, { enrolled: await enrollStudentsInSubject(s, M.Student) }, 'Enrollments synced');
  }));
});

router.post('/enrollments/sync', admin, asyncHandler(async (_req, res) => {
  const students = await M.Student.find({ status: 'active' });
  let n = 0;
  for (const s of students) n += await syncEnrollments(s);
  ok(res, { created: n }, 'Enrollments synced');
}));

/** Elective enrolment management. */
router.get('/enrollments', authorize('admin', 'faculty'), asyncHandler(async (req, res) => {
  const { subject } = req.query;
  if (!subject) throw AppError.badRequest('subject is required');
  const items = await M.Enrollment.find({ subject }).populate('student', 'studentId firstName lastName section').lean();
  ok(res, items);
}));
router.post('/enrollments', admin, validate(V.enrollmentSchema), asyncHandler(async (req, res) => {
  const [student, subject] = await Promise.all([M.Student.findById(req.body.student), M.Subject.findById(req.body.subject)]);
  if (!student || !subject) throw AppError.notFound('Student or subject not found');
  const e = await M.Enrollment.findOneAndUpdate({ student: student._id, subject: subject._id }, { $set: { status: 'enrolled', semester: subject.semester } }, { upsert: true, new: true });
  ok(res, e, 'Student enrolled', 201);
}));
router.delete('/enrollments/:id', admin, asyncHandler(async (req, res) => {
  const e = await M.Enrollment.findByIdAndUpdate(req.params.id, { status: 'dropped' }, { new: true });
  if (!e) throw AppError.notFound('Enrollment not found');
  ok(res, e, 'Enrollment dropped');
}));

export default router;
