import { Router } from 'express';
import PDFDocument from 'pdfkit';
import mongoose from 'mongoose';
import { protect, authorize, facultyProfile } from '../middleware/auth.js';
import { Student, Faculty, Mark, Attendance, Fee, Application, Complaint, Subject, getSettings } from '../models/index.js';
import { asyncHandler, ok, filtersFromQuery, parsePagination, pageMeta, toDay, escapeRegex } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { toCsv } from '../utils/csv.js';
import { computeResults } from '../services/grading.js';
import { percentage } from '../services/attendance.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect, authorize('admin', 'faculty'));

const fullName = (o) => (o ? `${o.firstName || ''} ${o.lastName || ''}`.trim() : '');
const MAX_ROWS = 5000;

function dateRange(q, field) {
  if (!q.from && !q.to) return {};
  return { [field]: { ...(q.from && { $gte: toDay(q.from) }), ...(q.to && { $lte: new Date(toDay(q.to).getTime() + 86400000 - 1) }) } };
}
function searchOr(q, fields) {
  if (!q.search) return {};
  const rx = new RegExp(escapeRegex(String(q.search).slice(0, 80)), 'i');
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

/** Faculty may only report on subjects they teach. */
async function subjectFilter(req, requested) {
  if (req.user.role === 'admin') return requested ? { subject: requested } : {};
  const mine = (
    await Subject.find({ faculty: (await facultyProfile(req))._id })
      .select('_id')
      .lean()
  ).map((s) => String(s._id));
  if (requested) {
    if (!mine.includes(String(requested))) throw AppError.forbidden('You can only report on your own subjects');
    return { subject: requested };
  }
  return { subject: { $in: mine } };
}

const adminOnly = (req) => {
  if (req.user.role !== 'admin') throw AppError.forbidden('This report is restricted to administrators');
};

/** Report catalogue: each returns { rows, columns } for the (already validated) query. */
const REPORTS = {
  students: async (req) => {
    adminOnly(req);
    const filter = {
      ...filtersFromQuery(req.query, {
        department: 'id',
        program: 'id',
        semester: 'number',
        section: 'id',
        status: 'string',
        admissionYear: 'number',
      }),
      ...searchOr(req.query, ['firstName', 'lastName', 'studentId', 'email']),
      ...dateRange(req.query, 'createdAt'),
    };
    const rows = await Student.find(filter)
      .sort({ studentId: 1 })
      .limit(MAX_ROWS)
      .populate('department program section', 'name code')
      .lean();
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
  faculty: async (req) => {
    adminOnly(req);
    const filter = {
      ...filtersFromQuery(req.query, { department: 'id', status: 'string' }),
      ...searchOr(req.query, ['firstName', 'lastName', 'employeeId', 'email']),
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
  attendance: async (req) => {
    const { subject, section } = req.query;
    const match = { ...(await subjectFilter(req, subject)), ...dateRange(req.query, 'date') };
    if (section) match.section = section;
    const raw = await Attendance.aggregate([
      { $match: matchIds(match) },
      { $group: { _id: { s: '$student', sub: '$subject', st: '$status' }, c: { $sum: 1 } } },
    ]);
    const map = new Map();
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
    const sMap = new Map(students.map((s) => [String(s._id), s]));
    const subMap = new Map(subjects.map((s) => [String(s._id), s]));
    let rows = entries.map((e) => ({
      ...e,
      pct: percentage(e),
      studentDoc: sMap.get(String(e.student)),
      subjectDoc: subMap.get(String(e.subject)),
    }));
    if (req.query.belowThreshold === 'true') rows = rows.filter((x) => x.pct !== null && x.pct < settings.attendanceThreshold);
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
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
  marks: async (req) => {
    const filter = {
      ...(await subjectFilter(req, req.query.subject)),
      ...filtersFromQuery(req.query, { examType: 'string', semester: 'number' }),
      ...dateRange(req.query, 'updatedAt'),
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
  results: async (req) => {
    adminOnly(req);
    const semester = req.query.semester ? Number(req.query.semester) : undefined;
    const sFilter = {
      ...filtersFromQuery(req.query, { department: 'id', program: 'id', section: 'id' }),
      status: 'active',
      ...searchOr(req.query, ['firstName', 'lastName', 'studentId']),
    };
    if (semester) sFilter.semester = semester;
    const students = await Student.find(sFilter).sort({ studentId: 1 }).limit(1000).lean();
    const rows = [];
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
  fees: async (req) => {
    adminOnly(req);
    const filter = { ...dateRange(req.query, 'dueDate') };
    let rows = await Fee.find(filter)
      .sort({ dueDate: 1 })
      .limit(MAX_ROWS)
      .populate('student', 'studentId firstName lastName')
      .lean({ virtuals: true });
    rows = rows.map((f) => ({
      ...f,
      pending: Math.max(f.amountDue - f.amountPaid, 0),
      status:
        f.amountPaid >= f.amountDue ? 'paid' : f.amountPaid > 0 ? 'partial' : new Date(f.dueDate) < new Date() ? 'overdue' : 'pending',
    }));
    if (req.query.status) rows = rows.filter((x) => x.status === req.query.status);
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
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
  placements: async (req) => {
    adminOnly(req);
    const filter = { ...filtersFromQuery(req.query, { status: 'string', job: 'id' }), ...dateRange(req.query, 'createdAt') };
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
  complaints: async (req) => {
    adminOnly(req);
    const filter = {
      ...filtersFromQuery(req.query, { status: 'string', category: 'string', priority: 'string' }),
      ...searchOr(req.query, ['subject']),
      ...dateRange(req.query, 'createdAt'),
    };
    const rows = await Complaint.find(filter)
      .sort({ createdAt: -1 })
      .limit(MAX_ROWS)
      .populate('student', 'studentId firstName lastName')
      .lean();
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

/** aggregate() doesn't auto-cast ids like find() does */
function matchIds(match) {
  const out = { ...match };
  const cast = (v) => (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v) ? new mongoose.Types.ObjectId(v) : v);
  for (const k of ['subject', 'section']) {
    if (out[k]?.$in) out[k] = { $in: out[k].$in.map(cast) };
    else if (out[k]) out[k] = cast(out[k]);
  }
  return out;
}

function sendPdf(res, title, rows, columns) {
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);
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
  const drawRow = (cells, bold) => {
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
  const val = (row, c) => {
    const v = typeof c.value === 'function' ? c.value(row) : row[c.value];
    return v instanceof Date ? v.toISOString().slice(0, 10) : v;
  };
  rows.forEach((row) => drawRow(columns.map((c) => val(row, c))));
  doc.end();
}

r.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const def = REPORTS[req.params.type];
    if (!def) throw AppError.notFound('Unknown report type');
    const { rows, columns } = await def(req);
    const format = req.query.format || 'json';
    await audit(req, 'REPORT_GENERATED', 'Report', req.params.type, { format });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.csv"`);
      return res.send('﻿' + toCsv(rows, columns));
    }
    if (format === 'pdf') return sendPdf(res, `${req.params.type[0].toUpperCase()}${req.params.type.slice(1)} Report`, rows, columns);

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 });
    const flat = rows
      .slice(skip, skip + limit)
      .map((row) => Object.fromEntries(columns.map((c) => [c.label, typeof c.value === 'function' ? c.value(row) : row[c.value]])));
    ok(res, { columns: columns.map((c) => c.label), rows: flat }, 'OK', 200, pageMeta(page, limit, rows.length));
  })
);

export default r;
