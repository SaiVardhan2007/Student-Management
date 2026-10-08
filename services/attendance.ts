// Attendance calculations: percentage rules and summaries per student / subject.
// Used by attendance.service.ts and the dashboards.
import mongoose from 'mongoose';
import { Attendance, getSettings } from '@/models';

// Aggregation pipelines do not cast strings to ObjectIds automatically, so we do it here.
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Attendance % = (present + late) / (all sessions except excused) * 100.
 * Excused sessions are ignored so they neither help nor hurt the student.
 */
export function percentage({ present = 0, late = 0, absent = 0 }) {
  const total = present + late + absent;
  return total ? Math.round(((present + late) / total) * 10000) / 100 : null;
}

// Turn rows like { status: 'present', count: 5 } into { present: 5, absent: 0, late: 0, excused: 0 }.
function foldCounts(rows) {
  const out = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

/** Overall + per-subject + per-month attendance for one student. */
export async function summarize(studentId, { from, to, subject, subjectIds }: { from?: Date; to?: Date; subject?: string; subjectIds?: any[] } = {}) {
  const settings = await getSettings();
  const match: Record<string, any> = { student: oid(studentId) };
  if (subjectIds) {
    // restricted viewer (faculty): only their own subjects, optionally narrowed to one
    const allowed = subjectIds.map(String);
    match.subject = { $in: (subject ? allowed.filter((id) => id === String(subject)) : allowed).map(oid) };
  } else if (subject) match.subject = oid(subject);
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

  // group the per-subject rows by subject
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
      return {
        subject: s.subject,
        code: s.code,
        name: s.name,
        ...counts,
        total: counts.present + counts.absent + counts.late + counts.excused,
        percentage: pct,
        belowThreshold: pct !== null && pct < settings.attendanceThreshold,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const overallCounts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const s of subjects) {
    overallCounts.present += s.present;
    overallCounts.absent += s.absent;
    overallCounts.late += s.late;
    overallCounts.excused += s.excused;
  }
  const overallPct = percentage(overallCounts);

  // group the per-month rows by month
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
    overall: {
      ...overallCounts,
      total: overallCounts.present + overallCounts.absent + overallCounts.late + overallCounts.excused,
      percentage: overallPct,
      belowThreshold: overallPct !== null && overallPct < settings.attendanceThreshold,
    },
    subjects,
    months,
  };
}

/** Per-student percentage for one subject (used for class reports & warnings). */
export async function subjectPercentages(subjectId, studentIds, { from, to }: { from?: Date; to?: Date } = {}) {
  const match: Record<string, any> = { subject: oid(subjectId), student: { $in: studentIds.map(oid) } };
  if (from || to) match.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const rows = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: { student: '$student', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const r of rows) {
    const k = String(r._id.student);
    if (!map.has(k)) map.set(k, { present: 0, absent: 0, late: 0, excused: 0 });
    map.get(k)[r._id.status] = r.count;
  }
  return map;
}
