import type { Ctx } from '@/lib/context';
import { User, Student } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { createAccount, generatePassword } from '@/services/accounts';
import { audit } from '@/services/audit';

export async function list(ctx: Ctx) {
  const { items, meta } = await paginate(User, ctx, {
    filter: filtersFromQuery(ctx.query, { role: 'string', isActive: 'bool' }),
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
  const isSelf = String(user._id) === String(ctx.user._id);
  if (isSelf && (ctx.body.isActive === false || (ctx.body.role && ctx.body.role !== 'admin'))) {
    throw AppError.badRequest('You cannot deactivate or demote your own account');
  }
  if (ctx.body.role && ctx.body.role !== user.role && ['student', 'faculty'].some((r) => r === user.role || r === ctx.body.role)) {
    throw AppError.badRequest('Role cannot be changed to or from student/faculty');
  }
  const roleChanged = ctx.body.role && ctx.body.role !== user.role;
  user.set(ctx.body);
  if (ctx.body.isActive === false) user.set('refreshTokens', []);
  await user.save();
  await audit(ctx, roleChanged ? 'USER_PERMISSIONS_CHANGED' : 'USER_UPDATED', 'User', user._id, {
    fields: Object.keys(ctx.body),
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
