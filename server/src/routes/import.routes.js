import { Router } from 'express';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { protect, authorize } from '../middleware/auth.js';
import { uploadCsv } from '../middleware/upload.js';
import { Student, Department, Program, Section, User } from '../models/index.js';
import { z, email, optionalPhone, reqStr } from '../middleware/validate.js';
import { formatZodError } from '../middleware/validate.js';
import { asyncHandler, ok, created } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { createAccount } from '../services/accounts.js';
import { syncEnrollments } from '../services/enrollment.js';
import { audit } from '../services/audit.js';
import { toCsv } from '../utils/csv.js';

const r = Router();
r.use(protect, authorize('admin'));

export const TEMPLATE_COLUMNS = [
  'studentId',
  'firstName',
  'lastName',
  'email',
  'phone',
  'gender',
  'dateOfBirth',
  'departmentCode',
  'programCode',
  'semester',
  'batch',
  'section',
  'admissionYear',
  'guardianName',
  'guardianPhone',
];
const MAX_ROWS = 2000;
const TTL = 30 * 60 * 1000;
/** Parsed previews awaiting confirmation (single-process, local deployment). */
const previews = new Map();
setInterval(() => {
  for (const [k, v] of previews) if (v.expires < Date.now()) previews.delete(k);
}, 60 * 1000).unref();

const rowSchema = z.object({
  studentId: reqStr(30),
  firstName: reqStr(60),
  lastName: reqStr(60),
  email,
  phone: optionalPhone,
  gender: z
    .enum(['male', 'female', 'other'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  dateOfBirth: z.union([z.literal('').transform(() => undefined), z.coerce.date()]).optional(),
  departmentCode: reqStr(20),
  programCode: reqStr(20),
  semester: z.coerce.number().int().min(1).max(12).default(1),
  batch: z.string().trim().max(20).optional(),
  section: z.string().trim().max(30).optional(),
  admissionYear: z.union([z.literal('').transform(() => undefined), z.coerce.number().int().min(1990).max(2100)]).optional(),
  guardianName: z.string().trim().max(100).optional(),
  guardianPhone: optionalPhone,
});

r.get('/students/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
  const sample = {
    studentId: 'S2025001',
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha.rao@example.edu',
    phone: '9876543210',
    gender: 'female',
    dateOfBirth: '2006-05-14',
    departmentCode: 'CSE',
    programCode: 'BTECH-CSE',
    semester: 1,
    batch: '2025',
    section: 'A',
    admissionYear: 2025,
    guardianName: 'R. Rao',
    guardianPhone: '9876500000',
  };
  res.send(
    '\uFEFF' +
      toCsv(
        [sample],
        TEMPLATE_COLUMNS.map((c) => ({ label: c, value: c }))
      )
  );
});

r.post(
  '/students/preview',
  uploadCsv,
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('Please choose a CSV file');
    let records;
    try {
      records = parse(req.file.buffer, {
        columns: (h) =>
          h.map((x) =>
            String(x)
              .replace(/^\uFEFF/, '')
              .trim()
          ),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
      });
    } catch (err) {
      throw AppError.badRequest(`The file is not valid CSV: ${err.message}`);
    }
    if (!records.length) throw AppError.badRequest('The file has no data rows');
    if (records.length > MAX_ROWS) throw AppError.badRequest(`Too many rows (max ${MAX_ROWS} per import)`);
    const missing = TEMPLATE_COLUMNS.slice(0, 9).filter((c) => !(c in records[0]));
    if (missing.length) throw AppError.badRequest(`Missing required column(s): ${missing.join(', ')}`);

    const [depts, progs, sections, existing] = await Promise.all([
      Department.find().select('code').lean(),
      Program.find().select('code department').lean(),
      Section.find().select('name program batch semester').lean(),
      Student.find({
        $or: [
          { studentId: { $in: records.map((x) => String(x.studentId || '').toUpperCase()) } },
          { email: { $in: records.map((x) => String(x.email || '').toLowerCase()) } },
        ],
      })
        .select('studentId email')
        .lean(),
    ]);
    const usedUsers = new Set(
      (
        await User.find({ email: { $in: records.map((x) => String(x.email || '').toLowerCase()) } })
          .select('email')
          .lean()
      ).map((u) => u.email)
    );
    const deptByCode = new Map(depts.map((d) => [d.code, d]));
    const progByCode = new Map(progs.map((p) => [p.code, p]));
    const existingIds = new Set(existing.map((e) => e.studentId));
    const existingEmails = new Set(existing.map((e) => e.email));
    const seenIds = new Set();
    const seenEmails = new Set();

    const rows = records.map((raw, i) => {
      const line = i + 2; // header is line 1
      const parsed = rowSchema.safeParse(raw);
      const errors = parsed.success ? [] : formatZodError(parsed.error).map((e) => `${e.field}: ${e.message}`);
      let data = null;
      if (parsed.success) {
        const d = parsed.data;
        const sid = d.studentId.toUpperCase();
        const dept = deptByCode.get(d.departmentCode.toUpperCase());
        const prog = progByCode.get(d.programCode.toUpperCase());
        if (!dept) errors.push(`departmentCode: "${d.departmentCode}" does not exist`);
        if (!prog) errors.push(`programCode: "${d.programCode}" does not exist`);
        if (dept && prog && String(prog.department) !== String(dept._id)) errors.push('programCode does not belong to departmentCode');
        let section;
        if (d.section && prog) {
          section = sections.find(
            (s) =>
              String(s.program) === String(prog._id) &&
              s.name.toLowerCase() === d.section.toLowerCase() &&
              (!d.batch || s.batch === d.batch) &&
              s.semester === d.semester
          );
          if (!section) errors.push(`section: "${d.section}" not found for this program/batch/semester`);
        }
        if (existingIds.has(sid) || seenIds.has(sid))
          errors.push(`studentId: "${sid}" already exists${seenIds.has(sid) ? ' in this file' : ''}`);
        if (existingEmails.has(d.email) || usedUsers.has(d.email) || seenEmails.has(d.email))
          errors.push(`email: "${d.email}" already exists${seenEmails.has(d.email) ? ' in this file' : ''}`);
        seenIds.add(sid);
        seenEmails.add(d.email);
        if (!errors.length) {
          data = {
            studentId: sid,
            firstName: d.firstName,
            lastName: d.lastName,
            email: d.email,
            phone: d.phone,
            gender: d.gender,
            dateOfBirth: d.dateOfBirth,
            department: dept._id,
            program: prog._id,
            semester: d.semester,
            batch: d.batch,
            section: section?._id,
            admissionYear: d.admissionYear,
            guardian: d.guardianName || d.guardianPhone ? { name: d.guardianName, phone: d.guardianPhone } : undefined,
          };
        }
      }
      return { line, raw, data, errors };
    });

    const id = crypto.randomBytes(12).toString('hex');
    previews.set(id, { rows: rows.filter((x) => x.data), userId: String(req.user._id), expires: Date.now() + TTL });
    const validCount = rows.filter((x) => x.data).length;
    ok(
      res,
      {
        importId: id,
        total: rows.length,
        validCount,
        invalidCount: rows.length - validCount,
        rows: rows.map((x) => ({
          line: x.line,
          studentId: x.raw.studentId,
          name: `${x.raw.firstName || ''} ${x.raw.lastName || ''}`.trim(),
          email: x.raw.email,
          valid: !x.errors.length,
          errors: x.errors,
        })),
      },
      'File validated. Review the preview before confirming.'
    );
  })
);

r.post(
  '/students/confirm',
  asyncHandler(async (req, res) => {
    const { importId } = req.body || {};
    const p = previews.get(importId);
    if (!p || p.userId !== String(req.user._id) || p.expires < Date.now())
      throw AppError.badRequest('This import preview has expired. Please upload the file again.');
    previews.delete(importId);
    const results = { created: [], failed: [] };
    for (const { line, data } of p.rows) {
      try {
        const { user, temporaryPassword } = await createAccount({
          name: `${data.firstName} ${data.lastName}`,
          email: data.email,
          role: 'student',
        });
        try {
          const s = await Student.create({ ...data, user: user._id });
          await syncEnrollments(s);
          results.created.push({ studentId: s.studentId, email: s.email, name: `${s.firstName} ${s.lastName}`, temporaryPassword });
        } catch (err) {
          await User.deleteOne({ _id: user._id });
          throw err;
        }
      } catch (err) {
        results.failed.push({ line, studentId: data.studentId, error: err.message });
      }
    }
    await audit(req, 'STUDENTS_IMPORTED', 'Student', undefined, { created: results.created.length, failed: results.failed.length });
    created(res, results, `${results.created.length} student(s) imported`);
  })
);

export default r;
