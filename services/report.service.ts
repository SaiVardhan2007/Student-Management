// Reports (students, faculty, attendance, marks, results, fees, placements, complaints) as JSON, CSV or PDF.
// Each report type builds { rows, columns }; generate() then formats it.
import PDFDocument from 'pdfkit';
import mongoose from 'mongoose';
import { Student, Faculty, Mark, Attendance, Fee, Application, Complaint, Subject, getSettings } from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { filtersFromQuery, parsePagination, pageMeta, toDay, escapeRegex } from '@/lib/query';
import { toCsv, type CsvColumn } from '@/lib/csv';
import { facultyProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { computeResults } from '@/services/grading';
import { percentage } from '@/services/attendance';
import { audit } from '@/services/audit';

const fullName = (o: any) => (o ? `${o.firstName || ''} ${o.lastName || ''}`.trim() : '');
/** Most rows an export (CSV/PDF) holds; the report meta, the files and the UI say so when a report is longer. */
const MAX_ROWS = 5000;
/** Results are graded per student, so that report is capped lower. */
const MAX_RESULT_ROWS = 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Mongo filter for ?from=&to= dates on the given field. "to" includes the whole last day. */
function dateRange(q: Record<string, any>, field: string) {
  if (!q.from && !q.to) return {};
  const range: Record<string, Date> = {};
  if (q.from) range.$gte = toDay(q.from);
  if (q.to) range.$lte = new Date(toDay(q.to).getTime() + MS_PER_DAY - 1);
  return { [field]: range };
}

/** Mongo filter for a case-insensitive text search over several fields. */
function searchOr(q: Record<string, any>, fields: string[]) {
  if (!q.search) return {};
  const rx = new RegExp(escapeRegex(String(q.search).slice(0, 80)), 'i');
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

/** Faculty may only report on subjects they teach. */
async function subjectFilter(ctx: Ctx, requested?: string) {
  if (ctx.user.role === 'admin') return requested ? { subject: requested } : {};
  const faculty = await facultyProfile(ctx);
  const mySubjects = await Subject.find({ faculty: faculty._id }).select('_id').lean();
  const mySubjectIds = mySubjects.map((s: any) => String(s._id));
  if (requested) {
    if (!mySubjectIds.includes(String(requested))) throw AppError.forbidden('You can only report on your own subjects');
    return { subject: requested };
  }
  return { subject: { $in: mySubjectIds } };
}

const adminOnly = (ctx: Ctx) => {
  if (ctx.user.role !== 'admin') throw AppError.forbidden('This report is restricted to administrators');
};

/** Convert id strings to ObjectIds, because aggregate() (unlike find()) does not do this automatically. */
function matchIds(match: Record<string, any>) {
  const out = { ...match };
  const cast = (v: any) => (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v) ? new mongoose.Types.ObjectId(v) : v);
  for (const k of ['subject', 'section']) {
    if (out[k]?.$in) out[k] = { $in: out[k].$in.map(cast) };
    else if (out[k]) out[k] = cast(out[k]);
  }
  return out;
}

/** Turn grouped attendance counts (one entry per student + subject + status) into one entry per student + subject. */
function countsPerStudentSubject(raw: any[]) {
  const byKey = new Map<string, any>();
  for (const x of raw) {
    const key = `${x._id.s}|${x._id.sub}`;
    if (!byKey.has(key)) {
      byKey.set(key, { student: x._id.s, subject: x._id.sub, present: 0, absent: 0, late: 0, excused: 0 });
    }
    byKey.get(key)[x._id.st] = x.c; // x._id.st is the status: present/absent/late/excused
  }
  return [...byKey.values()];
}

/** Does the student's id or name contain the search text? (used for in-memory filtering) */
function matchesSearch(student: any, search: unknown) {
  const text = String(search).toLowerCase();
  return `${student?.studentId} ${fullName(student)}`.toLowerCase().includes(text);
}

/** Fee status: paid, partial, overdue (past due date, nothing paid) or pending. */
function feeStatus(fee: any) {
  if (fee.amountPaid >= fee.amountDue) return 'paid';
  if (fee.amountPaid > 0) return 'partial';
  if (new Date(fee.dueDate) < new Date()) return 'overdue';
  return 'pending';
}

/**
 * `paged` means the database already returned just the requested page (and `total` is the full count);
 * otherwise rows is the whole set. `cap` is the most rows an export holds (null = no cap) and
 * `truncated` says that an export was cut at that cap.
 */
type ReportDef = { rows: any[]; columns: CsvColumn[]; total?: number; paged?: boolean; cap?: number | null; truncated?: boolean };
/** A page window for the on-screen table; null means "everything up to the export cap". */
type Window = { skip: number; limit: number } | null;

/**
 * Runs a report query. With a window only that page is read from the database; without one the first
 * `cap` rows are read (cap + 1, to notice that more exist) and `truncated` is set when the cap was hit.
 */
async function fromDb(win: Window, cap: number, count: () => Promise<number>, find: (skip: number, limit: number) => Promise<any[]>) {
  if (win) {
    const [total, rows] = await Promise.all([count(), find(win.skip, win.limit)]);
    return { rows, total, paged: true, cap, truncated: false };
  }
  const rows = await find(0, cap + 1);
  const truncated = rows.length > cap;
  return { rows: truncated ? rows.slice(0, cap) : rows, paged: false, cap, truncated };
}

/** Query filter on `field` for students whose name or ID contains the search text ({} when there is no search). */
async function studentSearch(ctx: Ctx, field = 'student') {
  if (!ctx.query.search) return {};
  const ids = await Student.distinct('_id', searchOr(ctx.query, ['firstName', 'lastName', 'studentId']));
  return { [field]: { $in: ids } };
}

/** Mongo condition for a fee status; matches how feeStatus() works out the status of a single fee. */
function feeStatusFilter(status: string) {
  const unpaid = { $and: [{ $lt: ['$amountPaid', '$amountDue'] }, { $lte: ['$amountPaid', 0] }] };
  const now = new Date();
  switch (status) {
    case 'paid':
      return { $expr: { $gte: ['$amountPaid', '$amountDue'] } };
    case 'partial':
      return { $expr: { $and: [{ $lt: ['$amountPaid', '$amountDue'] }, { $gt: ['$amountPaid', 0] }] } };
    case 'overdue':
      return { $expr: { $and: [unpaid, { $lt: ['$dueDate', now] }] } };
    case 'pending':
      return { $expr: { $and: [unpaid, { $gte: ['$dueDate', now] }] } };
    default:
      return { $expr: { $literal: false } };
  }
}

/** The available reports. Each one returns { rows, columns } for the (already validated) query. */
const REPORTS: Record<string, (ctx: Ctx, win: Window) => Promise<ReportDef>> = {
  students: async (ctx, win) => {
    adminOnly(ctx);
    const filter = {
      ...filtersFromQuery(ctx.query, {
        department: 'id',
        program: 'id',
        semester: 'number',
        section: 'id',
        status: 'string',
        admissionYear: 'number',
      }),
      ...searchOr(ctx.query, ['firstName', 'lastName', 'studentId', 'email']),
      ...dateRange(ctx.query, 'createdAt'),
    };
    const data = await fromDb(
      win,
      MAX_ROWS,
      () => Student.countDocuments(filter),
      (skip, limit) => Student.find(filter).sort({ studentId: 1 }).skip(skip).limit(limit).populate('department program section', 'name code').lean()
    );
    return {
      ...data,
      columns: [
        { label: 'Student ID', value: 'studentId' },
        { label: 'Name', value: fullName },
        { label: 'Email', value: 'email' },
        { label: 'Department', value: (x) => x.department?.name },
        { label: 'Program', value: (x) => x.program?.code },
        { label: 'Semester', value: 'semester' },
        { label: 'Section', value: (x) => x.section?.name },
        { label: 'Status', value: 'status' },
      ],
    };
  },
  faculty: async (ctx, win) => {
    adminOnly(ctx);
    const filter = {
      ...filtersFromQuery(ctx.query, { department: 'id', status: 'string' }),
      ...searchOr(ctx.query, ['firstName', 'lastName', 'employeeId', 'email']),
    };
    const data = await fromDb(
      win,
      MAX_ROWS,
      () => Faculty.countDocuments(filter),
      (skip, limit) => Faculty.find(filter).sort({ employeeId: 1 }).skip(skip).limit(limit).populate('department', 'name').lean()
    );
    return {
      ...data,
      columns: [
        { label: 'Employee ID', value: 'employeeId' },
        { label: 'Name', value: fullName },
        { label: 'Email', value: 'email' },
        { label: 'Department', value: (x) => x.department?.name },
        { label: 'Designation', value: 'designation' },
        { label: 'Status', value: 'status' },
      ],
    };
  },
  attendance: async (ctx) => {
    const { subject, section } = ctx.query;
    const match: Record<string, any> = { ...(await subjectFilter(ctx, subject)), ...dateRange(ctx.query, 'date') };
    if (section) match.section = section;
    const raw = await Attendance.aggregate([
      { $match: matchIds(match) },
      { $group: { _id: { s: '$student', sub: '$subject', st: '$status' }, c: { $sum: 1 } } },
    ]);
    const entries = countsPerStudentSubject(raw);
    const [students, subjects, settings] = await Promise.all([
      Student.find({ _id: { $in: entries.map((e) => e.student) } })
        .select('studentId firstName lastName')
        .lean(),
      Subject.find({ _id: { $in: entries.map((e) => e.subject) } })
        .select('code name')
        .lean(),
      getSettings(),
    ]);
    const studentById = new Map(students.map((s: any) => [String(s._id), s]));
    const subjectById = new Map(subjects.map((s: any) => [String(s._id), s]));
    let rows = entries.map((e) => ({
      ...e,
      pct: percentage(e),
      studentDoc: studentById.get(String(e.student)),
      subjectDoc: subjectById.get(String(e.subject)),
    }));
    if (ctx.query.belowThreshold === 'true') rows = rows.filter((x) => x.pct !== null && x.pct < settings.attendanceThreshold);
    if (ctx.query.search) rows = rows.filter((x) => matchesSearch(x.studentDoc, ctx.query.search));
    rows.sort((a, b) => String(a.studentDoc?.studentId).localeCompare(String(b.studentDoc?.studentId)));
    return {
      rows,
      cap: null,
      columns: [
        { label: 'Student ID', value: (x) => x.studentDoc?.studentId },
        { label: 'Name', value: (x) => fullName(x.studentDoc) },
        { label: 'Subject', value: (x) => x.subjectDoc?.code },
        { label: 'Present', value: 'present' },
        { label: 'Late', value: 'late' },
        { label: 'Absent', value: 'absent' },
        { label: 'Excused', value: 'excused' },
        { label: 'Attendance %', value: 'pct' },
      ],
    };
  },
  marks: async (ctx, win) => {
    const filter = {
      ...(await studentSearch(ctx)),
      ...(await subjectFilter(ctx, ctx.query.subject)),
      ...filtersFromQuery(ctx.query, { examType: 'string', semester: 'number' }),
      ...dateRange(ctx.query, 'updatedAt'),
    };
    const data = await fromDb(
      win,
      MAX_ROWS,
      () => Mark.countDocuments(filter),
      (skip, limit) =>
        Mark.find(filter)
          .sort({ subject: 1, student: 1, _id: 1 })
          .skip(skip)
          .limit(limit)
          .populate('student', 'studentId firstName lastName')
          .populate('subject', 'code name')
          .lean()
    );
    return {
      ...data,
      columns: [
        { label: 'Student ID', value: (x) => x.student?.studentId },
        { label: 'Name', value: (x) => fullName(x.student) },
        { label: 'Subject', value: (x) => x.subject?.code },
        { label: 'Component', value: 'examType' },
        { label: 'Obtained', value: 'marksObtained' },
        { label: 'Maximum', value: 'maxMarks' },
        { label: '%', value: (x) => Math.round((x.marksObtained / x.maxMarks) * 10000) / 100 },
      ],
    };
  },
  results: async (ctx, win) => {
    adminOnly(ctx);
    const semester = ctx.query.semester ? Number(ctx.query.semester) : undefined;
    const sFilter: Record<string, any> = {
      ...filtersFromQuery(ctx.query, { department: 'id', program: 'id', section: 'id' }),
      status: 'active',
      ...searchOr(ctx.query, ['firstName', 'lastName', 'studentId']),
    };
    if (semester) sFilter.semester = semester;
    // only the students on the requested page are graded, not the whole cohort
    const data = await fromDb(
      win,
      MAX_RESULT_ROWS,
      () => Student.countDocuments(sFilter),
      (skip, limit) => Student.find(sFilter).sort({ studentId: 1 }).skip(skip).limit(limit).lean()
    );
    const rows: any[] = [];
    for (const s of data.rows) {
      const res = await computeResults(s._id);
      // SGPA of the requested semester, or of the latest semester if none was requested
      const sem = semester ? res.semesters.find((x) => x.semester === semester) : res.semesters[res.semesters.length - 1];
      const subs = res.subjects.filter((x) => !semester || x.subject.semester === semester);
      rows.push({
        student: s,
        sgpa: sem?.sgpa ?? null,
        cgpa: res.cgpa,
        subjects: subs.length,
        failed: subs.filter((x) => !x.passed).length,
      });
    }
    return {
      ...data,
      rows,
      columns: [
        { label: 'Student ID', value: (x) => x.student.studentId },
        { label: 'Name', value: (x) => fullName(x.student) },
        { label: 'Semester', value: (x) => x.student.semester },
        { label: 'Subjects', value: 'subjects' },
        { label: 'Failed', value: 'failed' },
        { label: 'SGPA', value: 'sgpa' },
        { label: 'CGPA', value: 'cgpa' },
      ],
    };
  },
  fees: async (ctx, win) => {
    adminOnly(ctx);
    const filter = {
      ...dateRange(ctx.query, 'dueDate'),
      ...(ctx.query.status ? feeStatusFilter(String(ctx.query.status)) : {}),
      ...(await studentSearch(ctx)),
    };
    const data = await fromDb(
      win,
      MAX_ROWS,
      () => Fee.countDocuments(filter),
      (skip, limit) =>
        Fee.find(filter)
          .sort({ dueDate: 1, _id: 1 })
          .skip(skip)
          .limit(limit)
          .populate('student', 'studentId firstName lastName')
          .lean({ virtuals: true })
    );
    const rows = data.rows.map((f) => ({ ...f, pending: Math.max(f.amountDue - f.amountPaid, 0), status: feeStatus(f) }));
    return {
      ...data,
      rows,
      columns: [
        { label: 'Student ID', value: (x) => x.student?.studentId },
        { label: 'Name', value: (x) => fullName(x.student) },
        { label: 'Fee', value: 'title' },
        { label: 'Due', value: 'amountDue' },
        { label: 'Paid', value: 'amountPaid' },
        { label: 'Pending', value: 'pending' },
        { label: 'Due Date', value: 'dueDate' },
        { label: 'Status', value: 'status' },
      ],
    };
  },
  placements: async (ctx, win) => {
    adminOnly(ctx);
    const filter = { ...(await studentSearch(ctx)), ...filtersFromQuery(ctx.query, { status: 'string', job: 'id' }), ...dateRange(ctx.query, 'createdAt') };
    const data = await fromDb(
      win,
      MAX_ROWS,
      () => Application.countDocuments(filter),
      (skip, limit) =>
        Application.find(filter)
          .sort({ createdAt: -1, _id: 1 })
          .skip(skip)
          .limit(limit)
          .populate('student', 'studentId firstName lastName')
          .populate({ path: 'job', select: 'title package company', populate: { path: 'company', select: 'name' } })
          .lean()
    );
    return {
      ...data,
      columns: [
        { label: 'Student ID', value: (x) => x.student?.studentId },
        { label: 'Name', value: (x) => fullName(x.student) },
        { label: 'Company', value: (x) => x.job?.company?.name },
        { label: 'Role', value: (x) => x.job?.title },
        { label: 'Package', value: (x) => x.job?.package },
        { label: 'Status', value: 'status' },
        { label: 'Applied', value: 'createdAt' },
      ],
    };
  },
  complaints: async (ctx, win) => {
    adminOnly(ctx);
    const filter = {
      ...filtersFromQuery(ctx.query, { status: 'string', category: 'string', priority: 'string' }),
      ...searchOr(ctx.query, ['subject']),
      ...dateRange(ctx.query, 'createdAt'),
    };
    const data = await fromDb(
      win,
      MAX_ROWS,
      () => Complaint.countDocuments(filter),
      (skip, limit) =>
        Complaint.find(filter).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit).populate('student', 'studentId firstName lastName').lean()
    );
    return {
      ...data,
      columns: [
        { label: 'Student ID', value: (x) => x.student?.studentId },
        { label: 'Name', value: (x) => fullName(x.student) },
        { label: 'Category', value: 'category' },
        { label: 'Subject', value: 'subject' },
        { label: 'Priority', value: 'priority' },
        { label: 'Status', value: 'status' },
        { label: 'Created', value: 'createdAt' },
      ],
    };
  },
};

export const REPORT_TYPES = Object.keys(REPORTS);

/** Draw a simple table PDF (title, header row, one line per row) and return it as a Buffer. */
function renderPdf(title: string, rows: any[], columns: CsvColumn[], note?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .fontSize(16)
      .text(title, { align: 'left' })
      .fontSize(8)
      .fillColor('#666')
      .text(`Generated ${new Date().toLocaleString()} · ${rows.length} rows`)
      .moveDown();
    if (note) doc.fontSize(9).fillColor('#b00020').text(note).moveDown();
    doc.fillColor('#000');
    const width = doc.page.width - 72;
    const colW = width / columns.length;
    const drawRow = (cells: unknown[], bold?: boolean) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      cells.forEach((c, i) => doc.text(String(c ?? ''), 36 + i * colW, y, { width: colW - 4, height: 12, ellipsis: true, lineBreak: false }));
      doc.y = y + 14;
      if (doc.y > doc.page.height - 50) doc.addPage();
    };
    drawRow(
      columns.map((c) => c.label),
      true
    );
    doc
      .moveTo(36, doc.y - 2)
      .lineTo(36 + width, doc.y - 2)
      .strokeColor('#999')
      .stroke();
    const cellValue = (row: any, c: CsvColumn) => {
      const v = typeof c.value === 'function' ? c.value(row) : row[c.value];
      return v instanceof Date ? v.toISOString().slice(0, 10) : v;
    };
    for (const row of rows) drawRow(columns.map((c) => cellValue(row, c)));
    doc.end();
  });
}

/** Build a report (?format=json|csv|pdf). JSON is paginated; CSV and PDF include the rows up to the export cap. */
export async function generate(ctx: Ctx) {
  const type = ctx.params.type;
  const def = REPORTS[type];
  if (!def) throw AppError.notFound('Unknown report type');
  const format = ctx.query.format || 'json';
  const { page, limit, skip } = parsePagination(ctx.query, { defaultLimit: 25, maxLimit: 200 });
  const result = await def(ctx, format === 'json' ? { skip, limit } : null);
  const { rows, columns } = result;
  await audit(ctx, 'REPORT_GENERATED', 'Report', type, { format });

  // An export that hit its row cap says so inside the file and in a response header (the UI shows a warning)
  const note = result.truncated ? `Only the first ${result.cap} rows are included. Narrow the filters to export the rest.` : undefined;
  const flag: Record<string, string> = result.truncated ? { 'X-Report-Truncated': 'true' } : {};
  if (format === 'csv') {
    const noteLine = note ? `\r\n${toCsv([{ note }], [{ label: 'note', value: 'note' }]).split('\r\n')[1]}` : '';
    return new Response('\uFEFF' + toCsv(rows, columns) + noteLine, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${type}-report.csv"`, ...flag },
    });
  }
  if (format === 'pdf') {
    const pdf = await renderPdf(`${type[0].toUpperCase()}${type.slice(1)} Report`, rows, columns, note);
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${type}-report.pdf"`, ...flag },
    });
  }

  const total = result.total ?? rows.length;
  const pageRows = result.paged ? rows : rows.slice(skip, skip + limit);
  const flat = pageRows.map((row) => Object.fromEntries(columns.map((c) => [c.label, typeof c.value === 'function' ? c.value(row) : row[c.value]])));
  // truncated tells the UI that a CSV/PDF export of this report would be cut at exportLimit rows
  const exportLimit = result.cap === undefined ? null : result.cap;
  const meta = { ...pageMeta(page, limit, total), exportLimit, truncated: exportLimit !== null && total > exportLimit };
  return ok({ columns: columns.map((c) => c.label), rows: flat }, 'OK', 200, meta);
}
