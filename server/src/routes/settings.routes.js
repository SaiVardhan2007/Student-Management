import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate, z, optionalPhone } from '../middleware/validate.js';
import { uploadImage, toFileMeta, removeFile } from '../middleware/upload.js';
import { AuditLog, getSettings } from '../models/index.js';
import { asyncHandler, ok, paginate, filtersFromQuery } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { audit } from '../services/audit.js';

export const settingsRouter = Router();
export const auditRouter = Router();

const gradeScale = z
  .array(z.object({ grade: z.string().trim().min(1).max(12), minPercent: z.coerce.number().min(0).max(100), points: z.coerce.number().min(0).max(10) }))
  .min(2, 'Define at least two grades')
  .refine((g) => g.some((x) => x.minPercent === 0), { message: 'One grade must start at 0%' })
  .refine((g) => new Set(g.map((x) => x.minPercent)).size === g.length, { message: 'Grade boundaries must be unique' });

const updateSchema = z.object({
  collegeName: z.string().trim().min(2).max(150).optional(),
  contact: z.object({ email: z.string().trim().email().optional().or(z.literal('')), phone: optionalPhone, address: z.string().trim().max(300).optional(), website: z.string().trim().max(200).optional() }).optional(),
  attendanceThreshold: z.coerce.number().min(0).max(100).optional(),
  passPercentage: z.coerce.number().min(0).max(100).optional(),
  gradeScale: gradeScale.optional(),
  libraryFinePerDay: z.coerce.number().min(0).max(1000).optional(),
  libraryLoanDays: z.coerce.number().int().min(1).max(365).optional(),
});

// Branding only — used on the login page before authentication.
settingsRouter.get('/public', asyncHandler(async (_req, res) => {
  const s = await getSettings();
  ok(res, { collegeName: s.collegeName, logo: s.logo });
}));

settingsRouter.use(protect);
settingsRouter.get('/', asyncHandler(async (_req, res) => ok(res, await getSettings())));

settingsRouter.put('/', authorize('admin'), validate(updateSchema), asyncHandler(async (req, res) => {
  const s = await getSettings();
  s.set(req.body);
  await s.save();
  await audit(req, 'SETTINGS_UPDATED', 'Settings', s._id, { fields: Object.keys(req.body) });
  ok(res, s, 'Settings saved');
}));

settingsRouter.post('/logo', authorize('admin'), uploadImage('photos', 'logo'), asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('Please choose an image file');
  const s = await getSettings();
  removeFile(s.logo);
  s.logo = toFileMeta(req.file, 'photos').path;
  await s.save();
  await audit(req, 'SETTINGS_LOGO_UPDATED', 'Settings', s._id);
  ok(res, { logo: s.logo }, 'Logo updated');
}));

// ---- audit logs (admin only)
auditRouter.use(protect, authorize('admin'));
auditRouter.get('/', asyncHandler(async (req, res) => {
  const filter = filtersFromQuery(req.query, { user: 'id', action: 'string', entity: 'string', role: 'string' });
  const { from, to } = req.query;
  if (from || to) filter.timestamp = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(new Date(to).getTime() + 86400000 - 1) }) };
  const { items, meta } = await paginate(AuditLog, req, { filter, searchFields: ['userName', 'action', 'entity', 'entityId'], allowedSort: ['timestamp', 'action'], defaultSort: { timestamp: -1 } });
  ok(res, items, 'OK', 200, meta);
}));
auditRouter.get('/actions', asyncHandler(async (_req, res) => ok(res, (await AuditLog.distinct('action')).sort())));

