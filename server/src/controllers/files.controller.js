import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { StudentDocument, Submission, Complaint, Achievement, Student } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';
import { UPLOAD_CATEGORIES } from '../middleware/upload.js';

const NAME_RE = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;
const INLINE = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

/** Is the current user the owner (or parent of the owner, or staff) of a student-owned record? */
async function canSeeStudentRecord(req, studentId) {
  const { role } = req.user;
  if (role === 'admin' || role === 'faculty') return true;
  if (role === 'student') return !!(await Student.exists({ _id: studentId, user: req.user._id }));
  if (role === 'parent') return (req.user.children || []).some((c) => String(c) === String(studentId));
  return false;
}

/**
 * Sensitive categories are only served to the owner / staff. Other categories
 * (materials, notices, ...) are shared content; filenames are random 128-bit ids
 * and every request requires a valid login.
 */
async function authorizeFile(req, category, relPath) {
  if (category === 'documents') {
    const d = await StudentDocument.findOne({ 'file.path': relPath }).select('student').lean();
    // Only admin and the owning student/parent may open identity/academic documents.
    if (!d) return false;
    if (req.user.role === 'faculty') return false;
    return canSeeStudentRecord(req, d.student);
  }
  if (category === 'submissions') {
    const s = await Submission.findOne({ 'files.path': relPath }).select('student').lean();
    return !!s && canSeeStudentRecord(req, s.student);
  }
  if (category === 'complaints') {
    const c = await Complaint.findOne({ 'attachment.path': relPath }).select('student').lean();
    return !!c && canSeeStudentRecord(req, c.student);
  }
  if (category === 'achievements') {
    const a = await Achievement.findOne({ 'certificate.path': relPath }).select('student').lean();
    return !!a && canSeeStudentRecord(req, a.student);
  }
  return true;
}

export const serve = asyncHandler(async (req, res) => {
  const { category, filename } = req.params;
  if (!UPLOAD_CATEGORIES.includes(category) || !NAME_RE.test(filename)) throw AppError.notFound('File not found');
  const rel = `${category}/${filename}`;
  if (!(await authorizeFile(req, category, rel))) throw AppError.forbidden('You do not have access to this file');
  const abs = path.resolve(env.uploadDir, category, filename);
  if (!abs.startsWith(path.resolve(env.uploadDir) + path.sep) || !fs.existsSync(abs)) throw AppError.notFound('File not found');
  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Disposition', `${INLINE.has(ext) && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(abs);
});
