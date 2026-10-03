import { User, Student } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { createAccount, generatePassword } from '../services/accounts.js';
import { audit } from '../services/audit.js';

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await paginate(User, req, {
    filter: filtersFromQuery(req.query, { role: 'string', isActive: 'bool' }),
    searchFields: ['name', 'email'],
    allowedSort: ['name', 'email', 'role', 'lastLoginAt'],
  });
  ok(res, items, 'OK', 200, meta);
});

export const get = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const u = await User.findById(req.params.id).populate('children', 'studentId firstName lastName');
  if (!u) throw AppError.notFound('User not found');
  ok(res, u);
});

export const create = asyncHandler(async (req, res) => {
  const { children, ...data } = req.body;
  if (data.role === 'student' || data.role === 'faculty') {
    throw AppError.badRequest('Create students and faculty from their own pages so their profiles are set up correctly');
  }
  if (children?.length && (await Student.countDocuments({ _id: { $in: children } })) !== children.length) throw AppError.badRequest('One or more linked students were not found');
  const { user, temporaryPassword } = await createAccount(data);
  if (children?.length) {
    user.children = children;
    await user.save();
  }
  await audit(req, 'USER_CREATED', 'User', user._id, { role: user.role });
  created(res, { user, temporaryPassword }, 'User created');
});

export const update = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');
  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && (req.body.isActive === false || (req.body.role && req.body.role !== 'admin'))) {
    throw AppError.badRequest('You cannot deactivate or demote your own account');
  }
  if (req.body.role && req.body.role !== user.role && ['student', 'faculty'].some((r) => r === user.role || r === req.body.role)) {
    throw AppError.badRequest('Role cannot be changed to or from student/faculty');
  }
  const roleChanged = req.body.role && req.body.role !== user.role;
  user.set(req.body);
  if (req.body.isActive === false) user.set('refreshTokens', []);
  await user.save();
  await audit(req, roleChanged ? 'USER_PERMISSIONS_CHANGED' : 'USER_UPDATED', 'User', user._id, { fields: Object.keys(req.body), role: user.role });
  ok(res, user, 'User updated');
});

export const resetPassword = asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const user = await User.findById(req.params.id).select('+password +refreshTokens');
  if (!user) throw AppError.notFound('User not found');
  const temporaryPassword = generatePassword();
  user.password = temporaryPassword;
  user.mustChangePassword = true;
  user.refreshTokens = [];
  await user.save();
  await audit(req, 'USER_PASSWORD_RESET_BY_ADMIN', 'User', user._id);
  ok(res, { temporaryPassword }, 'Temporary password generated');
});
