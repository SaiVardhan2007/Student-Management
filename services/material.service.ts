import { Material } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import { toFileMeta, removeFile } from '@/lib/upload';
import type { Ctx } from '@/lib/context';
import { assertSubjectAccess } from '@/services/access';
import { visibleSubjectIds } from '@/services/scope';
import { notifyStudents } from '@/services/notify';
import { audit } from '@/services/audit';

const POPULATE = [
  { path: 'subject', select: 'code name' },
  { path: 'uploadedBy', select: 'name' },
];

export async function list(ctx: Ctx) {
  const filter = filtersFromQuery(ctx.query, { subject: 'id', type: 'string' });
  const visible = await visibleSubjectIds(ctx);
  if (visible)
    filter.subject = filter.subject ? (visible.some((s: any) => String(s) === String(filter.subject)) ? filter.subject : null) : { $in: visible };
  const { items, meta } = await paginate(Material, ctx, {
    filter,
    searchFields: ['title', 'description'],
    allowedSort: ['createdAt', 'title'],
    populate: POPULATE,
  });
  return ok(items, 'OK', 200, meta);
}

export async function create(ctx: Ctx) {
  if (!ctx.file) throw AppError.badRequest('Please choose a file to upload');
  const subject = await assertSubjectAccess(ctx, ctx.body.subject);
  const m = await Material.create({ ...ctx.body, file: toFileMeta(ctx.file, 'materials'), uploadedBy: ctx.user._id });
  await notifyStudents(
    { program: subject.program, semester: subject.semester },
    { title: `New study material: ${m.title}`, message: `${subject.code} - ${subject.name}`, type: 'general', link: '/materials' }
  );
  await audit(ctx, 'MATERIAL_UPLOADED', 'Material', m._id, { subject: subject.code });
  return created(m, 'Material uploaded');
}

export async function remove(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const m = await Material.findById(ctx.params.id);
  if (!m) throw AppError.notFound('Material not found');
  await assertSubjectAccess(ctx, m.subject);
  removeFile(m.file);
  await m.deleteOne();
  await audit(ctx, 'MATERIAL_DELETED', 'Material', m._id);
  return ok(null, 'Material deleted');
}
