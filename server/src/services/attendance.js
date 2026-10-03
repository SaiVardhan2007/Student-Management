import mongoose from 'mongoose';
import { Attendance, getSettings } from '../models/index.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Attendance % = (present + late) / (all sessions except excused) * 100.
 * Excused sessions are ignored so they neither help nor hurt the student.
 */
export function percentage({ present = 0, late = 0, absent = 0 }) {
  const total = present + late + absent;
  return total ? Math.round(((present + late) / total) * 10000) / 100 : null;
}

function foldCounts(rows) {
  const out = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

/** Overall + per-subject + per-month attendance for one student. */
export async function summarize(studentId, { from, to, subject } = {}) {
  const settings = await getSettings();
  const match = { student: oid(studentId) };
  if (subject) match.subject = oid(subject);
  if (from || to) match.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

  const [bySubject, byMonth] = await Promise.all([
    Attendance.aggregate([
      { $match: match },
      { $group: { _id: { subject: '$subject', status: '$status' }, count: { $sum: 1 } } },
      { $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subj' } },
      { $unwind: '$subj' },
      { $project: { _id: 0, subject: '$_id.subject', code: '$subj.code', name: '$subj.name', status: '$_id.status', count: 1 } },
    ]),
    Attendance.aggregate([
      { $match: match },
      { $group: { _id: { month: { $dateToString: { format: '%Y-%m', date: '$date' } }, status: '$status' }, count: { $sum: 1 } } },
      { $project: { _id: 0, month: '$_id.month', status: '$_id.status', count: 1 } },
    ]),
  ]);

  const subjMap = new Map();
  for (const r of bySubject) {
    const k = String(r.subject);
    if (!subjMap.has(k)) subjMap.set(k, { subject: r.subject, code: r.code, name: r.name, rows: [] });
    subjMap.get(k).rows.push(r);
  }
  const subjects = [...subjMap.values()]
    .map((s) => {
      const counts = foldCounts(s.rows);
      const pct = percentage(counts);
      return { subject: s.subject, code: s.code, name: s.name, ...counts, total: counts.present + counts.absent + counts.late + counts.excused, percentage: pct, belowThreshold: pct !== null && pct < settings.attendanceThreshold };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const overallCounts = subjects.reduce((a, s) => ({ present: a.present + s.present, absent: a.absent + s.absent, late: a.late + s.late, excused: a.excused + s.excused }), { present: 0, absent: 0, late: 0, excused: 0 });
  const overallPct = percentage(overallCounts);

  const monthMap = new Map();
  for (const r of byMonth) {
    if (!monthMap.has(r.month)) monthMap.set(r.month, []);
    monthMap.get(r.month).push(r);
  }
  const months = [...monthMap.entries()]
    .map(([month, rows]) => {
      const c = foldCounts(rows);
      return { month, ...c, percentage: percentage(c) };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    threshold: settings.attendanceThreshold,
    overall: { ...overallCounts, total: Object.values(overallCounts).reduce((a, b) => a + b, 0), percentage: overallPct, belowThreshold: overallPct !== null && overallPct < settings.attendanceThreshold },
    subjects,
    months,
  };
}

/** Per-student percentage for one subject (used for class reports & warnings). */
export async function subjectPercentages(subjectId, studentIds, { from, to } = {}) {
  const match = { subject: oid(subjectId), student: { $in: studentIds.map(oid) } };
  if (from || to) match.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const rows = await Attendance.aggregate([{ $match: match }, { $group: { _id: { student: '$student', status: '$status' }, count: { $sum: 1 } } }]);
  const map = new Map();
  for (const r of rows) {
    const k = String(r._id.student);
    if (!map.has(k)) map.set(k, { present: 0, absent: 0, late: 0, excused: 0 });
    map.get(k)[r._id.status] = r.count;
  }
  return map;
}
