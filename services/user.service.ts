// Admin user management: list, create, update and reset passwords for user accounts.
import type { Ctx } from '@/lib/context';
import { User, Student, Faculty, Department } from '@/models';
import { sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { createAccount, generatePassword } from '@/services/accounts';
import { audit } from '@/services/audit';

export async function list(ctx: Ctx) {
  const { items, meta } = await paginate(User, ctx, {
    filter: filtersFromQuery(ctx.query, { role: 'string', isActive: 'bool', approvalStatus: 'string' }),
    searchFields: ['name', 'email'],
    allowedSort: ['name', 'email', 'role', 'lastLoginAt'],
  });
  return ok(items, 'OK', 200, meta);
}

export async function get(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const u = await User.findById(ctx.params.id).populate('children', 'studentId firstName lastName');
  if (!u) throw AppError.notFound('User not found');
  return ok(u);
}

export async function create(ctx: Ctx) {
  const { children, ...data } = ctx.body;
  if (data.role === 'student' || data.role === 'faculty') {
    throw AppError.badRequest('Create students and faculty from their own pages so their profiles are set up correctly');
  }
  if (children?.length && (await Student.countDocuments({ _id: { $in: children } })) !== children.length)
    throw AppError.badRequest('One or more linked students were not found');
  const { user, temporaryPassword } = await createAccount(data as any);
  if (children?.length) {
    user.children = children;
    await user.save();
  }
  await audit(ctx, 'USER_CREATED', 'User', user._id, { role: user.role });
  return created({ user, temporaryPassword }, 'User created');
}

export async function update(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const user = await User.findById(ctx.params.id);
  if (!user) throw AppError.notFound('User not found');
  if (user.approvalStatus !== 'approved' && ctx.body.isActive === true)
    throw AppError.badRequest('Approve the faculty request first');
  const isSelf = String(user._id) === String(ctx.user._id);
  if (isSelf && (ctx.body.isActive === false || (ctx.body.role && ctx.body.role !== 'admin'))) {
    throw AppError.badRequest('You cannot deactivate or demote your own account');
  }
  const roleChanged = ctx.body.role && ctx.body.role !== user.role;
  if (roleChanged) {
    // student/faculty accounts are tied to a profile, so their role can't be switched
    const involvesProfileRole = ['student', 'faculty'].some((r) => r === user.role || r === ctx.body.role);
    if (involvesProfileRole) throw AppError.badRequest('Role cannot be changed to or from student/faculty');
  }
  const body = { ...ctx.body };
  const finalRole = body.role || user.role;

  // linked students only make sense for parents, and they must exist (checked before anything is saved)
  if (body.children !== undefined) {
    if (finalRole !== 'parent') throw AppError.badRequest('Linked students can only be set on parent accounts');
    body.children = [...new Set<string>(body.children.map(String))];
    if (body.children.length && (await Student.countDocuments({ _id: { $in: body.children } })) !== body.children.length)
      throw AppError.badRequest('One or more linked students were not found');
  } else if (roleChanged && finalRole !== 'parent') {
    body.children = [];
  }

  // the email is the login: it must stay unique across accounts and the student/faculty profiles
  const emailChanged = !!body.email && body.email !== user.email;
  if (emailChanged) {
    const [account, student, faculty] = await Promise.all([
      User.exists({ email: body.email, _id: { $ne: user._id } }),
      Student.exists({ email: body.email, user: { $ne: user._id } }),
      Faculty.exists({ email: body.email, user: { $ne: user._id } }),
    ]);
    if (account || student || faculty)
      throw AppError.conflict('An account with this email already exists', [{ field: 'email', message: 'Already exists' }]);
  }

  const activeChanged = body.isActive !== undefined && body.isActive !== user.isActive;
  user.set(body);
  // deactivated users must be logged out everywhere
  if (body.isActive === false) user.set('refreshTokens', []);
  await user.save();

  // keep the student/faculty profile consistent with the account
  if (emailChanged) {
    await Promise.all([Student.updateOne({ user: user._id }, { email: body.email }), Faculty.updateOne({ user: user._id }, { email: body.email })]);
  }
  if (activeChanged && user.role === 'student') {
    await Student.updateOne(
      { user: user._id, status: body.isActive ? 'inactive' : 'active' },
      { status: body.isActive ? 'active' : 'inactive' }
    );
  }
  if (activeChanged && user.role === 'faculty') {
    await Faculty.updateOne(
      { user: user._id, status: body.isActive ? 'inactive' : { $ne: 'inactive' } },
      { status: body.isActive ? 'active' : 'inactive' }
    );
  }
  await audit(ctx, roleChanged ? 'USER_PERMISSIONS_CHANGED' : 'USER_UPDATED', 'User', user._id, {
    fields: Object.keys(body),
    role: user.role,
  });
  return ok(user, 'User updated');
}

export async function resetPassword(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const user = await User.findById(ctx.params.id).select('+password +refreshTokens');
  if (!user) throw AppError.notFound('User not found');
  const temporaryPassword = generatePassword();
  user.password = temporaryPassword;
  user.mustChangePassword = true;
  user.refreshTokens = [];
  await user.save();
  await audit(ctx, 'USER_PASSWORD_RESET_BY_ADMIN', 'User', user._id);
  return ok({ temporaryPassword }, 'Temporary password generated');
}

/** Approve a pending faculty sign-up: activate the account and create the faculty profile linked to it. */
export async function approve(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const user = await User.findById(ctx.params.id);
  if (!user || user.role !== 'faculty') throw AppError.notFound('Faculty request not found');
  if (user.approvalStatus !== 'pending') throw AppError.badRequest('This request has already been reviewed');
  const { employeeId, department, designation } = ctx.body;
  if (!(await Department.exists({ _id: department }))) throw AppError.badRequest('Department not found');
  if (await Faculty.exists({ $or: [{ employeeId: employeeId.toUpperCase() }, { email: user.email }] }))
    throw AppError.conflict('A faculty member with this Employee ID or email already exists');

  const [firstName, ...rest] = user.name.split(/\s+/);
  await Faculty.create({ user: user._id, employeeId, firstName, lastName: rest.join(' ') || '-', email: user.email, department, designation });
  user.approvalStatus = 'approved';
  user.isActive = true;
  await user.save();
  await sendMail(user.email, 'Your faculty account was approved', `Hello ${user.name},\n\nYour account is approved. You can sign in at ${env.appUrl}/login`);
  await audit(ctx, 'FACULTY_APPROVED', 'User', user._id, { employeeId });
  return ok(user, 'Faculty approved');
}

export async function reject(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const user = await User.findById(ctx.params.id);
  if (!user || user.role !== 'faculty') throw AppError.notFound('Faculty request not found');
  if (user.approvalStatus !== 'pending') throw AppError.badRequest('This request has already been reviewed');
  user.approvalStatus = 'rejected';
  await user.save();
  await sendMail(user.email, 'Your faculty registration was not approved', `Hello ${user.name},\n\nYour registration request was not approved. Please contact the administrator.`);
  await audit(ctx, 'FACULTY_REJECTED', 'User', user._id);
  return ok(user, 'Request rejected');
}
