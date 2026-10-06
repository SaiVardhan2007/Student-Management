import path from 'path';
import fs from 'fs';
import { env } from '@/lib/env';
import { StudentDocument, Submission, Complaint, Achievement, Student } from '@/models';
import { AppError } from '@/lib/errors';
import { UPLOAD_CATEGORIES } from '@/lib/upload';
import type { Ctx } from '@/lib/context';

const NAME_RE = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;
const INLINE = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
};

/** Is the current user the owner (or parent of the owner, or staff) of a student-owned record? */
async function canSeeStudentRecord(ctx: Ctx, studentId: unknown) {
  const { role } = ctx.user;
  if (role === 'admin' || role === 'faculty') return true;
  if (role === 'student') return !!(await Student.exists({ _id: studentId, user: ctx.user._id }));
  if (role === 'parent') return (ctx.user.children || []).some((c: any) => String(c) === String(studentId));
  return false;
}

/**
 * Sensitive categories are only served to the owner / staff. Other categories
 * (materials, notices, ...) are shared content; filenames are random 128-bit ids
 * and every request requires a valid login.
 */
async function authorizeFile(ctx: Ctx, category: string, relPath: string) {
  if (category === 'documents') {
    const d = await StudentDocument.findOne({ 'file.path': relPath }).select('student').lean<any>();
    // Only admin and the owning student/parent may open identity/academic documents.
    if (!d) return false;
    if (ctx.user.role === 'faculty') return false;
    return canSeeStudentRecord(ctx, d.student);
  }
  if (category === 'submissions') {
    const s = await Submission.findOne({ 'files.path': relPath }).select('student').lean<any>();
    return !!s && canSeeStudentRecord(ctx, s.student);
  }
  if (category === 'complaints') {
    const c = await Complaint.findOne({ 'attachment.path': relPath }).select('student').lean<any>();
    return !!c && canSeeStudentRecord(ctx, c.student);
  }
  if (category === 'achievements') {
    const a = await Achievement.findOne({ 'certificate.path': relPath }).select('student').lean<any>();
    return !!a && canSeeStudentRecord(ctx, a.student);
  }
  return true;
}

export async function serve(ctx: Ctx) {
  const { category, filename } = ctx.params;
  if (!UPLOAD_CATEGORIES.includes(category) || !NAME_RE.test(filename)) throw AppError.notFound('File not found');
  const rel = `${category}/${filename}`;
  if (!(await authorizeFile(ctx, category, rel))) throw AppError.forbidden('You do not have access to this file');
  const abs = path.resolve(env.uploadDir, category, filename);
  if (!abs.startsWith(path.resolve(env.uploadDir) + path.sep) || !fs.existsSync(abs)) throw AppError.notFound('File not found');
  const ext = path.extname(filename).toLowerCase();
  const data = await fs.promises.readFile(abs);
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(data.length),
      'Content-Disposition': `${INLINE.has(ext) && ctx.query.download !== '1' ? 'inline' : 'attachment'}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
