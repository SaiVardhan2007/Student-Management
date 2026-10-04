import { Faculty, User, Department, Subject, Section } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { facultyProfile } from '../middleware/auth.js';
import { createAccount } from '../services/accounts.js';
import { audit } from '../services/audit.js';
import { sendCsv } from '../utils/csv.js';

const POPULATE = [{ path: 'department', select: 'name code' }];
const FILTERS = { department: 'id', status: 'string', designation: 'string' };

const withSubjects = async (f) => {
  const subjects = await Subject.find({ faculty: f._id })
    .populate('program', 'name code')
    .populate('sections', 'name semester')
    .select('code name semester credits type program sections')
    .lean();
  return { ...f.toJSON(), subjects };
};

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await paginate(Faculty, req, {
    filter: filtersFromQuery(req.query, FILTERS),
    searchFields: ['firstName', 'lastName', 'employeeId', 'email', 'designation'],
    allowedSort: ['firstName', 'lastName', 'employeeId', 'status', 'joiningDate'],
    populate: POPULATE,
  });
  ok(res, items, 'OK', 200, meta);
});

export const get = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const f = await Faculty.findById(req.params.id).populate(POPULATE).populate('user', 'email isActive lastLoginAt');
  if (!f) throw AppError.notFound('Faculty member not found');
  ok(res, await withSubjects(f));
});

export const getMe = asyncHandler(async (req, res) => {
  const f = await facultyProfile(req);
  await f.populate(POPULATE);
  ok(res, await withSubjects(f));
});

export const create = asyncHandler(async (req, res) => {
  const { password, ...data } = req.body;
  if (!(await Department.exists({ _id: data.department }))) throw AppError.badRequest('Department not found');
  if (await Faculty.exists({ $or: [{ employeeId: data.employeeId.toUpperCase() }, { email: data.email }] })) {
    throw AppError.conflict('A faculty member with this Employee ID or email already exists');
  }
  const { user, temporaryPassword } = await createAccount({
    name: `${data.firstName} ${data.lastName}`,
    email: data.email,
    role: 'faculty',
    password,
  });
  let f;
  try {
    f = await Faculty.create({ ...data, user: user._id });
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }
  await audit(req, 'FACULTY_CREATED', 'Faculty', f._id, { employeeId: f.employeeId });
  created(res, { faculty: f, temporaryPassword }, 'Faculty created');
});

export const update = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const f = await Faculty.findById(req.params.id);
  if (!f) throw AppError.notFound('Faculty member not found');
  if (req.body.department && !(await Department.exists({ _id: req.body.department }))) throw AppError.badRequest('Department not found');
  f.set(req.body);
  await f.save();
  const u = {};
  if (req.body.firstName || req.body.lastName || req.body.email) Object.assign(u, { name: `${f.firstName} ${f.lastName}`, email: f.email });
  if (req.body.status) u.isActive = f.status !== 'inactive';
  if (Object.keys(u).length && f.user) await User.updateOne({ _id: f.user }, u);
  await audit(req, 'FACULTY_UPDATED', 'Faculty', f._id, { fields: Object.keys(req.body) });
  ok(res, f, 'Faculty updated');
});

async function setActive(req, res, active) {
  requireValidId(req.params.id);
  const f = await Faculty.findById(req.params.id);
  if (!f) throw AppError.notFound('Faculty member not found');
  f.status = active ? 'active' : 'inactive';
  await f.save();
  if (f.user) await User.updateOne({ _id: f.user }, { isActive: active });
  await audit(req, active ? 'FACULTY_ACTIVATED' : 'FACULTY_DEACTIVATED', 'Faculty', f._id);
  ok(res, f, active ? 'Faculty activated' : 'Faculty deactivated');
}
export const activate = asyncHandler((req, res) => setActive(req, res, true));
export const deactivate = asyncHandler((req, res) => setActive(req, res, false));

/** Assign a set of subjects (and optionally sections) to a faculty member. */
export const assignSubjects = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const f = await Faculty.findById(req.params.id);
  if (!f) throw AppError.notFound('Faculty member not found');
  const { subjects, sections } = req.body;
  const found = await Subject.find({ _id: { $in: subjects } });
  if (found.length !== subjects.length) throw AppError.badRequest('One or more subjects were not found');
  if (sections?.length && (await Section.countDocuments({ _id: { $in: sections } })) !== sections.length)
    throw AppError.badRequest('One or more sections were not found');
  // release previously assigned subjects that are not in the new list
  await Subject.updateMany({ faculty: f._id, _id: { $nin: subjects } }, { $unset: { faculty: 1 } });
  await Subject.updateMany({ _id: { $in: subjects } }, { faculty: f._id, ...(sections ? { sections } : {}) });
  await audit(req, 'FACULTY_SUBJECTS_ASSIGNED', 'Faculty', f._id, { subjects });
  ok(res, await withSubjects(f), 'Subjects assigned');
});

export const exportCsv = asyncHandler(async (req, res) => {
  const rows = await Faculty.find(filtersFromQuery(req.query, FILTERS)).sort({ employeeId: 1 }).populate(POPULATE).limit(20000).lean();
  sendCsv(res, 'faculty.csv', rows, [
    { label: 'Employee ID', value: 'employeeId' },
    { label: 'First Name', value: 'firstName' },
    { label: 'Last Name', value: 'lastName' },
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    { label: 'Department', value: (r) => r.department?.name },
    { label: 'Designation', value: 'designation' },
    { label: 'Status', value: 'status' },
    { label: 'Joining Date', value: 'joiningDate' },
  ]);
});
