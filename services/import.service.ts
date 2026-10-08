// Bulk student import from CSV. Two steps: preview() validates the file, confirm() saves the valid rows.
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { Student, Department, Program, Section, User } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { toCsv } from '@/lib/csv';
import type { Ctx } from '@/lib/context';
import { z, email, optionalPhone, reqStr, formatZodError } from '@/validators/common';
import { syncEnrollments } from '@/services/enrollment';
import { audit } from '@/services/audit';

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
const TTL = 30 * 60 * 1000; // a preview stays valid for 30 minutes

/** Validated previews waiting for confirmation, kept in memory (fine for a single server process). */
type Preview = { rows: { line: number; data: any }[]; userId: string; expires: number };
const g = globalThis as unknown as { __importPreviews?: Map<string, Preview> };
const previews: Map<string, Preview> = g.__importPreviews || (g.__importPreviews = new Map());

/** Remove expired previews. */
function sweep() {
  for (const [k, v] of previews) if (v.expires < Date.now()) previews.delete(k);
}

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

/** Download a sample CSV with the expected columns. */
export async function template() {
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
  const columns = TEMPLATE_COLUMNS.map((c) => ({ label: c, value: c }));
  return new Response(
    '﻿' + toCsv([sample], columns), // the BOM at the start lets Excel read UTF-8 correctly
    { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student-import-template.csv"' } }
  );
}

/** Read the uploaded CSV file into a list of row objects (one per student). */
function readCsvRecords(ctx: Ctx): Record<string, any>[] {
  if (!ctx.file?.buffer) throw AppError.badRequest('Please choose a CSV file');
  let records: Record<string, any>[];
  try {
    records = parse(ctx.file.buffer, {
      // clean the header names (remove the invisible BOM that Excel adds, and spaces)
      columns: (h: string[]) => h.map((x) => String(x).replace(/^﻿/, '').trim()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    });
  } catch (err: any) {
    throw AppError.badRequest(`The file is not valid CSV: ${err.message}`);
  }
  if (!records.length) throw AppError.badRequest('The file has no data rows');
  if (records.length > MAX_ROWS) throw AppError.badRequest(`Too many rows (max ${MAX_ROWS} per import)`);
  // the first 9 template columns are required
  const missing = TEMPLATE_COLUMNS.slice(0, 9).filter((c) => !(c in records[0]));
  if (missing.length) throw AppError.badRequest(`Missing required column(s): ${missing.join(', ')}`);
  return records;
}

/** Data from the database that each row is checked against. */
type Lookups = {
  deptByCode: Map<string, any>;
  progByCode: Map<string, any>;
  sections: any[];
  existingIds: Set<string>;
  existingEmails: Set<string>; // emails already used by a student or a user account
};

async function loadLookups(records: Record<string, any>[]): Promise<Lookups> {
  const upperIds = records.map((x) => String(x.studentId || '').toUpperCase());
  const lowerEmails = records.map((x) => String(x.email || '').toLowerCase());
  const [depts, progs, sections, students, users] = await Promise.all([
    Department.find().select('code').lean<any[]>(),
    Program.find().select('code department').lean<any[]>(),
    Section.find().select('name program batch semester').lean<any[]>(),
    Student.find({ $or: [{ studentId: { $in: upperIds } }, { email: { $in: lowerEmails } }] })
      .select('studentId email')
      .lean<any[]>(),
    User.find({ email: { $in: lowerEmails } })
      .select('email')
      .lean<any[]>(),
  ]);
  return {
    deptByCode: new Map(depts.map((d) => [d.code, d])),
    progByCode: new Map(progs.map((p) => [p.code, p])),
    sections,
    existingIds: new Set(students.map((s) => s.studentId)),
    existingEmails: new Set([...students.map((s) => s.email), ...users.map((u) => u.email)]),
  };
}

/**
 * Validate one CSV row. Returns the clean data to save (or null if invalid) plus a list of error messages.
 * seenIds/seenEmails track values already used earlier in the same file, to catch duplicates inside the file.
 */
function checkRow(raw: any, lookups: Lookups, seenIds: Set<string>, seenEmails: Set<string>) {
  // a blank cell means "not given": optional columns stay empty and semester falls back to its default (1)
  const parsed = rowSchema.safeParse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === '' ? undefined : v])));
  if (!parsed.success) {
    return { data: null, errors: formatZodError(parsed.error).map((e) => `${e.field}: ${e.message}`) };
  }

  const errors: string[] = [];
  const d = parsed.data;
  const studentId = d.studentId.toUpperCase();
  const dept = lookups.deptByCode.get(d.departmentCode.toUpperCase());
  const prog = lookups.progByCode.get(d.programCode.toUpperCase());
  if (!dept) errors.push(`departmentCode: "${d.departmentCode}" does not exist`);
  if (!prog) errors.push(`programCode: "${d.programCode}" does not exist`);
  if (dept && prog && String(prog.department) !== String(dept._id)) errors.push('programCode does not belong to departmentCode');

  let section: any;
  if (d.section && prog) {
    section = lookups.sections.find(
      (s) =>
        String(s.program) === String(prog._id) &&
        s.name.toLowerCase() === d.section!.toLowerCase() &&
        (!d.batch || s.batch === d.batch) &&
        s.semester === d.semester
    );
    if (!section) errors.push(`section: "${d.section}" not found for this program/batch/semester`);
  }

  if (lookups.existingIds.has(studentId) || seenIds.has(studentId)) {
    errors.push(`studentId: "${studentId}" already exists${seenIds.has(studentId) ? ' in this file' : ''}`);
  }
  if (lookups.existingEmails.has(d.email) || seenEmails.has(d.email)) {
    errors.push(`email: "${d.email}" already exists${seenEmails.has(d.email) ? ' in this file' : ''}`);
  }
  seenIds.add(studentId);
  seenEmails.add(d.email);
  if (errors.length) return { data: null, errors };

  const hasGuardian = d.guardianName || d.guardianPhone;
  const data = {
    studentId,
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
    guardian: hasGuardian ? { name: d.guardianName, phone: d.guardianPhone } : undefined,
  };
  return { data, errors };
}

/**
 * Step 1 of import: validate the CSV and return a preview.
 * Valid rows are kept in memory under an importId; nothing is saved until confirm().
 */
export async function preview(ctx: Ctx) {
  sweep();
  const records = readCsvRecords(ctx);
  const lookups = await loadLookups(records);
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  const rows = records.map((raw, i) => {
    const line = i + 2; // line 1 of the file is the header
    const { data, errors } = checkRow(raw, lookups, seenIds, seenEmails);
    return { line, raw, data, errors };
  });

  const importId = crypto.randomBytes(12).toString('hex');
  const validRows = rows.filter((x) => x.data);
  previews.set(importId, { rows: validRows, userId: String(ctx.user._id), expires: Date.now() + TTL });
  return ok(
    {
      importId,
      total: rows.length,
      validCount: validRows.length,
      invalidCount: rows.length - validRows.length,
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
}

/** Step 2 of import: create the accounts and students from a previously validated preview. */
export async function confirm(ctx: Ctx) {
  const { importId } = ctx.body || {};
  const p = previews.get(importId);
  if (!p || p.userId !== String(ctx.user._id) || p.expires < Date.now())
    throw AppError.badRequest('This import preview has expired. Please upload the file again.');
  previews.delete(importId);
  const results: { created: any[]; failed: any[] } = { created: [], failed: [] };
  for (const { line, data } of p.rows) {
    try {
      // no login yet: the student claims the record by registering with this email and admission number
      const s = await Student.create(data);
      await syncEnrollments(s);
      results.created.push({ studentId: s.studentId, email: s.email, name: `${s.firstName} ${s.lastName}` });
    } catch (err: any) {
      results.failed.push({ line, studentId: data.studentId, error: err.message });
    }
  }
  await audit(ctx, 'STUDENTS_IMPORTED', 'Student', undefined, { created: results.created.length, failed: results.failed.length });
  return created(results, `${results.created.length} student(s) imported`);
}
