import { Mark, Subject, getSettings } from '../models/index.js';

/** Map a percentage to { grade, points } using the configured grade scale. */
export function gradeFor(percentage, scale) {
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((g) => percentage >= g.minPercent) || sorted[sorted.length - 1] || { grade: '-', points: 0 };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compute per-subject results and SGPA/CGPA for a student.
 * Subject total = sum(obtained)/sum(max) across recorded components.
 */
export async function computeResults(studentId, { semester } = {}) {
  const settings = await getSettings();
  const marks = await Mark.find({ student: studentId, ...(semester ? { semester } : {}) })
    .populate('subject', 'code name credits type semester')
    .lean();

  const bySubject = new Map();
  for (const m of marks) {
    if (!m.subject) continue;
    const key = String(m.subject._id);
    if (!bySubject.has(key)) bySubject.set(key, { subject: m.subject, components: [], obtained: 0, max: 0 });
    const row = bySubject.get(key);
    row.components.push({ examType: m.examType, marksObtained: m.marksObtained, maxMarks: m.maxMarks });
    row.obtained += m.marksObtained;
    row.max += m.maxMarks;
  }

  const subjects = [...bySubject.values()].map((r) => {
    const percentage = r.max ? round2((r.obtained / r.max) * 100) : 0;
    const g = gradeFor(percentage, settings.gradeScale);
    return {
      subject: r.subject,
      components: r.components,
      total: r.obtained,
      maxTotal: r.max,
      percentage,
      grade: g.grade,
      gradePoints: g.points,
      passed: percentage >= settings.passPercentage,
    };
  });

  const semesters = new Map();
  for (const s of subjects) {
    const sem = s.subject.semester;
    if (!semesters.has(sem)) semesters.set(sem, { semester: sem, credits: 0, weighted: 0 });
    const e = semesters.get(sem);
    e.credits += s.subject.credits;
    e.weighted += s.subject.credits * s.gradePoints;
  }
  const semesterResults = [...semesters.values()]
    .map((e) => ({ semester: e.semester, credits: e.credits, sgpa: e.credits ? round2(e.weighted / e.credits) : 0 }))
    .sort((a, b) => a.semester - b.semester);

  const totals = semesterResults.reduce((a, s) => ({ c: a.c + s.credits, w: a.w + s.sgpa * s.credits }), { c: 0, w: 0 });
  return {
    subjects,
    semesters: semesterResults,
    cgpa: totals.c ? round2(totals.w / totals.c) : 0,
  };
}

/** Latest CGPA helper for eligibility checks. */
export async function cgpaOf(studentId) {
  return (await computeResults(studentId)).cgpa;
}

export { Subject };
