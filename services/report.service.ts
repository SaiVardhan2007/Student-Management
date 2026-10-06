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
const MAX_ROWS = 5000;

function dateRange(q: Record<string, any>, field: string) {
  if (!q.from && !q.to) return {};
  return { [field]: { ...(q.from && { $gte: toDay(q.from) }), ...(q.to && { $lte: new Date(toDay(q.to).getTime() + 86400000 - 1) }) } };
}
function searchOr(q: Record<string, any>, fields: string[]) {
  if (!q.search) return {};
  const rx = new RegExp(escapeRegex(String(q.search).slice(0, 80)), 'i');
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

/** Faculty may only report on subjects they teach. */
async function subjectFilter(ctx: Ctx, requested?: string) {
  if (ctx.user.role === 'admin') return requested ? { subject: requested } : {};
  const mine = (
    await Subject.find({ faculty: (await facultyProfile(ctx))._id })
      .select('_id')
      .lean()
  ).map((s: any) => String(s._id));
  if (requested) {
    if (!mine.includes(String(requested))) throw AppError.forbidden('You can only report on your own subjects');
    return { subject: requested };
  }
  return { subject: { $in: mine } };
}

const adminOnly = (ctx: Ctx) => {
  if (ctx.user.role !== 'admin') throw AppError.forbidden('This report is restricted to administrators');
};

/** aggregate() doesn't auto-cast ids like find() does */
function matchIds(match: Record<string, any>) {
  const out = { ...match };
  const cast = (v: any) => (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v) ? new mongoose.Types.ObjectId(v) : v);
  for (const k of ['subject', 'section']) {
    if (out[k]?.$in) out[k] = { $in: out[k].$in.map(cast) };
    else if (out[k]) out[k] = cast(out[k]);
  }
  return out;
}

type ReportDef = { rows: any[]; columns: CsvColumn[] };

/** Report catalogue: each returns { rows, columns } for the (already validated) query. */
const REPORTS: Record<string, (ctx: Ctx) => Promise<ReportDef>> = {
  students: async (ctx) => {
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
    const rows = await Student.find(filter).sort({ studentId: 1 }).limit(MAX_ROWS).populate('department program section', 'name code').lean();
    return {
      rows,
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
  faculty: async (ctx) => {
    adminOnly(ctx);
    const filter = {
      ...filtersFromQuery(ctx.query, { department: 'id', status: 'string' }),
      ...searchOr(ctx.query, ['firstName', 'lastName', 'employeeId', 'email']),
    };
    const rows = await Faculty.find(filter).sort({ employeeId: 1 }).limit(MAX_ROWS).populate('department', 'name').lean();
    return {
      rows,
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
    const map = new Map<string, any>();
    for (const x of raw) {
      const k = `${x._id.s}|${x._id.sub}`;
      const e = map.get(k) || { student: x._id.s, subject: x._id.sub, present: 0, absent: 0, late: 0, excused: 0 };
      e[x._id.st] = x.c;
      map.set(k, e);
    }
    const entries = [...map.values()];
    const [students, subjects, settings] = await Promise.all([
      Student.find({ _id: { $in: entries.map((e) => e.student) } })
        .select('studentId firstName lastName')
        .lean(),
      Subject.find({ _id: { $in: entries.map((e) => e.subject) } })
        .select('code name')
        .lean(),
      getSettings(),
    ]);
    const sMap = new Map(students.map((s: any) => [String(s._id), s]));
    const subMap = new Map(subjects.map((s: any) => [String(s._id), s]));
    let rows = entries.map((e) => ({
      ...e,
      pct: percentage(e),
      studentDoc: sMap.get(String(e.student)),
      subjectDoc: subMap.get(String(e.subject)),
    }));
    if (ctx.query.belowThreshold === 'true') rows = rows.filter((x) => x.pct !== null && x.pct < settings.attendanceThreshold);
    if (ctx.query.search) {
      const q = String(ctx.query.search).toLowerCase();
      rows = rows.filter((x) => `${x.studentDoc?.studentId} ${fullName(x.studentDoc)}`.toLowerCase().includes(q));
    }
    rows.sort((a, b) => String(a.studentDoc?.studentId).localeCompare(String(b.studentDoc?.studentId)));
    return {
      rows,
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
  marks: async (ctx) => {
    const filter = {
      ...(await subjectFilter(ctx, ctx.query.subject)),
      ...filtersFromQuery(ctx.query, { examType: 'string', semester: 'number' }),
      ...dateRange(ctx.query, 'updatedAt'),
    };
    const rows = await Mark.find(filter)
      .sort({ subject: 1, student: 1 })
      .limit(MAX_ROWS)
      .populate('student', 'studentId firstName lastName')
      .populate('subject', 'code name')
      .lean();
    return {
      rows,
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
  results: async (ctx) => {
    adminOnly(ctx);
    const semester = ctx.query.semester ? Number(ctx.query.semester) : undefined;
    const sFilter: Record<string, any> = {
      ...filtersFromQuery(ctx.query, { department: 'id', program: 'id', section: 'id' }),
      status: 'active',
      ...searchOr(ctx.query, ['firstName', 'lastName', 'studentId']),
    };
    if (semester) sFilter.semester = semester;
    const students = await Student.find(sFilter).sort({ studentId: 1 }).limit(1000).lean();
    const rows: any[] = [];
    for (const s of students) {
      const res = await computeResults(s._id);
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
  fees: async (ctx) => {
    adminOnly(ctx);
    const filter = { ...dateRange(ctx.query, 'dueDate') };
    let rows: any[] = await Fee.find(filter).sort({ dueDate: 1 }).limit(MAX_ROWS).populate('student', 'studentId firstName lastName').lean({ virtuals: true });
    rows = rows.map((f) => ({
      ...f,
      pending: Math.max(f.amountDue - f.amountPaid, 0),
      status: f.amountPaid >= f.amountDue ? 'paid' : f.amountPaid > 0 ? 'partial' : new Date(f.dueDate) < new Date() ? 'overdue' : 'pending',
    }));
    if (ctx.query.status) rows = rows.filter((x) => x.status === ctx.query.status);
    if (ctx.query.search) {
      const q = String(ctx.query.search).toLowerCase();
      rows = rows.filter((x) => `${x.student?.studentId} ${fullName(x.student)}`.toLowerCase().includes(q));
    }
    return {
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
  placements: async (ctx) => {
    adminOnly(ctx);
    const filter = { ...filtersFromQuery(ctx.query, { status: 'string', job: 'id' }), ...dateRange(ctx.query, 'createdAt') };
    const rows = await Application.find(filter)
      .sort({ createdAt: -1 })
      .limit(MAX_ROWS)
      .populate('student', 'studentId firstName lastName')
      .populate({ path: 'job', select: 'title package company', populate: { path: 'company', select: 'name' } })
      .lean();
    return {
      rows,
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
  complaints: async (ctx) => {
    adminOnly(ctx);
    const filter = {
      ...filtersFromQuery(ctx.query, { status: 'string', category: 'string', priority: 'string' }),
      ...searchOr(ctx.query, ['subject']),
      ...dateRange(ctx.query, 'createdAt'),
    };
    const rows = await Complaint.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS).populate('student', 'studentId firstName lastName').lean();
    return {
      rows,
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

/** Render a simple tabular PDF into memory. */
function renderPdf(title: string, rows: any[], columns: CsvColumn[]): Promise<Buffer> {
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
    const val = (row: any, c: CsvColumn) => {
      const v = typeof c.value === 'function' ? c.value(row) : row[c.value];
      return v instanceof Date ? v.toISOString().slice(0, 10) : v;
    };
    rows.forEach((row) => drawRow(columns.map((c) => val(row, c))));
    doc.end();
  });
}

export async function generate(ctx: Ctx) {
  const type = ctx.params.type;
  const def = REPORTS[type];
  if (!def) throw AppError.notFound('Unknown report type');
  const { rows, columns } = await def(ctx);
  const format = ctx.query.format || 'json';
  await audit(ctx, 'REPORT_GENERATED', 'Report', type, { format });
  if (format === 'csv') {
    return new Response('﻿' + toCsv(rows, columns), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${type}-report.csv"` },
    });
  }
  if (format === 'pdf') {
    const pdf = await renderPdf(`${type[0].toUpperCase()}${type.slice(1)} Report`, rows, columns);
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${type}-report.pdf"` },
    });
  }

  const { page, limit, skip } = parsePagination(ctx.query, { defaultLimit: 25, maxLimit: 200 });
  const flat = rows
    .slice(skip, skip + limit)
    .map((row) => Object.fromEntries(columns.map((c) => [c.label, typeof c.value === 'function' ? c.value(row) : row[c.value]])));
  return ok({ columns: columns.map((c) => c.label), rows: flat }, 'OK', 200, pageMeta(page, limit, rows.length));
}
