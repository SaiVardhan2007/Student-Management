// Serves uploaded files, after checking the logged-in user is allowed to see them.
import path from 'path';
import { getFile } from '@/lib/storage';
import { StudentDocument, Submission, Complaint, Achievement, Student, Faculty, Settings, Material, Assignment, Notice } from '@/models';
import { AppError } from '@/lib/errors';
import { UPLOAD_CATEGORIES } from '@/lib/upload';
import type { Ctx } from '@/lib/context';
import { visibleSubjectIds } from '@/services/scope';
import { studentProfile } from '@/lib/auth';
import { visibilityFilter } from '@/services/notice.service';

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

/** Can the current user see a record owned by this student? (admin/faculty, the student, or their parent) */
async function canSeeStudentRecord(ctx: Ctx, studentId: unknown) {
  const { role } = ctx.user;
  if (role === 'admin' || role === 'faculty') return true;
  if (role === 'student') return !!(await Student.exists({ _id: studentId, user: ctx.user._id }));
  if (role === 'parent') return (ctx.user.children || []).some((c: any) => String(c) === String(studentId));
  return false;
}

/**
 * Every category applies the same visibility rules as the matching list API
 * (subject access, notice audience, ownership). Filenames are random 128-bit ids
 * and every request also requires a valid login.
 */
async function canSeeSubject(ctx: Ctx, subjectId: unknown) {
  const subjects = await visibleSubjectIds(ctx); // null = admin, sees everything
  return !subjects || subjects.some((s: any) => String(s) === String(subjectId));
}

async function authorizeFile(ctx: Ctx, category: string, relPath: string) {
  if (category === 'documents') {
    const d = await StudentDocument.findOne({ 'file.path': relPath }).select('student').lean<any>();
    // Only admin and the owning student/parent may open identity/academic documents.
    if (!d) return false;
    if (ctx.user.role === 'faculty') return false;
    return canSeeStudentRecord(ctx, d.student);
  }
  if (category === 'submissions') {
    const s = await Submission.findOne({ 'files.path': relPath }).select('student assignment').lean<any>();
    if (!s) return false;
    if (ctx.user.role === 'faculty') {
      // faculty only see submissions to assignments of subjects they teach
      const a = await Assignment.findById(s.assignment).select('subject').lean<any>();
      return !!a && canSeeSubject(ctx, a.subject);
    }
    return canSeeStudentRecord(ctx, s.student);
  }
  if (category === 'complaints') {
    const c = await Complaint.findOne({ 'attachment.path': relPath }).select('student assignedTo').lean<any>();
    if (!c) return false;
    if (ctx.user.role === 'admin') return true;
    // staff only see tickets assigned to them (same scoping as the complaints API)
    if (ctx.user.role === 'faculty') return String(c.assignedTo) === String(ctx.user._id);
    return canSeeStudentRecord(ctx, c.student);
  }
  if (category === 'achievements') {
    const a = await Achievement.findOne({ 'certificate.path': relPath }).select('student').lean<any>();
    return !!a && canSeeStudentRecord(ctx, a.student);
  }
  if (category === 'materials') {
    const m = await Material.findOne({ 'file.path': relPath }).select('subject').lean<any>();
    return !!m && canSeeSubject(ctx, m.subject);
  }
  if (category === 'assignments') {
    const a = await Assignment.findOne({ 'attachment.path': relPath }).select('subject sections').lean<any>();
    if (!a || !(await canSeeSubject(ctx, a.subject))) return false;
    if (ctx.user.role === 'student' && a.sections?.length) {
      const st = await studentProfile(ctx);
      return a.sections.some((x: any) => String(x) === String(st.section));
    }
    return true;
  }
  if (category === 'notices') {
    return !!(await Notice.exists({ $and: [{ 'attachment.path': relPath }, await visibilityFilter(ctx)] }));
  }
  if (category === 'photos') {
    // the college logo is shown to every signed-in user (app shell)
    if (await Settings.exists({ logo: relPath })) return true;
    const st = await Student.findOne({ photo: relPath }).select('_id').lean<any>();
    if (st) return canSeeStudentRecord(ctx, st._id);
    // staff photos are not sensitive
    return !!(await Faculty.exists({ photo: relPath }));
  }
  // misc and anything else: administrators only
  return ctx.user.role === 'admin';
}

/** Send one uploaded file. The filename must look like our generated names and stay inside the upload folder. */
export async function serve(ctx: Ctx) {
  const { category, filename } = ctx.params;
  if (!UPLOAD_CATEGORIES.includes(category) || !NAME_RE.test(filename)) throw AppError.notFound('File not found');
  const rel = `${category}/${filename}`;
  if (!(await authorizeFile(ctx, category, rel))) throw AppError.forbidden('You do not have access to this file');
  const data = await getFile(category, filename);
  if (!data) throw AppError.notFound('File not found');
  const ext = path.extname(filename).toLowerCase();
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
