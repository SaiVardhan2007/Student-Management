import type { Ctx } from '@/lib/context';
import { Faculty, User, Department, Subject, Section } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId, type FilterSpec } from '@/lib/query';
import { facultyProfile } from '@/lib/auth';
import { createAccount } from '@/services/accounts';
import { audit } from '@/services/audit';
import { csvResponse } from '@/lib/csv';

const POPULATE = [{ path: 'department', select: 'name code' }];
const FILTERS: FilterSpec = { department: 'id', status: 'string', designation: 'string' };

const withSubjects = async (f) => {
  const subjects = await Subject.find({ faculty: f._id })
    .populate('program', 'name code')
    .populate('sections', 'name semester')
    .select('code name semester credits type program sections')
    .lean();
  return { ...f.toJSON(), subjects };
};

export async function list(ctx: Ctx) {
  const { items, meta } = await paginate(Faculty, ctx, {
    filter: filtersFromQuery(ctx.query, FILTERS),
    searchFields: ['firstName', 'lastName', 'employeeId', 'email', 'designation'],
    allowedSort: ['firstName', 'lastName', 'employeeId', 'status', 'joiningDate'],
    populate: POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function get(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const f = await Faculty.findById(ctx.params.id).populate(POPULATE).populate('user', 'email isActive lastLoginAt');
  if (!f) throw AppError.notFound('Faculty member not found');
  return ok(await withSubjects(f));
}

export async function getMe(ctx: Ctx) {
  const f = await facultyProfile(ctx);
  await f.populate(POPULATE);
  return ok(await withSubjects(f));
}

export async function create(ctx: Ctx) {
  const { password, ...data } = ctx.body;
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
  await audit(ctx, 'FACULTY_CREATED', 'Faculty', f._id, { employeeId: f.employeeId });
  return created({ faculty: f, temporaryPassword }, 'Faculty created');
}

export async function update(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const f = await Faculty.findById(ctx.params.id);
  if (!f) throw AppError.notFound('Faculty member not found');
  if (ctx.body.department && !(await Department.exists({ _id: ctx.body.department }))) throw AppError.badRequest('Department not found');
  f.set(ctx.body);
  await f.save();
  const u: Record<string, any> = {};
  if (ctx.body.firstName || ctx.body.lastName || ctx.body.email) Object.assign(u, { name: `${f.firstName} ${f.lastName}`, email: f.email });
  if (ctx.body.status) u.isActive = f.status !== 'inactive';
  if (Object.keys(u).length && f.user) await User.updateOne({ _id: f.user }, u);
  await audit(ctx, 'FACULTY_UPDATED', 'Faculty', f._id, { fields: Object.keys(ctx.body) });
  return ok(f, 'Faculty updated');
}

async function setActive(ctx: Ctx, active: boolean) {
  requireValidId(ctx.params.id);
  const f = await Faculty.findById(ctx.params.id);
  if (!f) throw AppError.notFound('Faculty member not found');
  f.status = active ? 'active' : 'inactive';
  await f.save();
  if (f.user) await User.updateOne({ _id: f.user }, { isActive: active });
  await audit(ctx, active ? 'FACULTY_ACTIVATED' : 'FACULTY_DEACTIVATED', 'Faculty', f._id);
  return ok(f, active ? 'Faculty activated' : 'Faculty deactivated');
}
export const activate = (ctx: Ctx) => setActive(ctx, true);
export const deactivate = (ctx: Ctx) => setActive(ctx, false);

/** Assign a set of subjects (and optionally sections) to a faculty member. */
export async function assignSubjects(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const f = await Faculty.findById(ctx.params.id);
  if (!f) throw AppError.notFound('Faculty member not found');
  const { subjects, sections } = ctx.body;
  const found = await Subject.find({ _id: { $in: subjects } });
  if (found.length !== subjects.length) throw AppError.badRequest('One or more subjects were not found');
  if (sections?.length && (await Section.countDocuments({ _id: { $in: sections } })) !== sections.length)
    throw AppError.badRequest('One or more sections were not found');
  // release previously assigned subjects that are not in the new list
  await Subject.updateMany({ faculty: f._id, _id: { $nin: subjects } }, { $unset: { faculty: 1 } });
  await Subject.updateMany({ _id: { $in: subjects } }, { faculty: f._id, ...(sections ? { sections } : {}) });
  await audit(ctx, 'FACULTY_SUBJECTS_ASSIGNED', 'Faculty', f._id, { subjects });
  return ok(await withSubjects(f), 'Subjects assigned');
}

export async function exportCsv(ctx: Ctx) {
  const rows = await Faculty.find(filtersFromQuery(ctx.query, FILTERS)).sort({ employeeId: 1 }).populate(POPULATE).limit(20000).lean();
  return csvResponse('faculty.csv', rows, [
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
}
