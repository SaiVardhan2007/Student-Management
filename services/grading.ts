// Grade and GPA calculation. Used by the marks, report and placement services.
import { Mark, Subject, getSettings } from '@/models';

/**
 * Map a percentage to { grade, points } using the grade scale from settings.
 * The scale is checked from the highest minimum percent down; the first match wins.
 * If nothing matches, the lowest grade is used.
 */
export function gradeFor(percentage, scale) {
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  const match = sorted.find((g) => percentage >= g.minPercent);
  if (match) return match;
  if (sorted.length > 0) return sorted[sorted.length - 1];
  return { grade: '-', points: 0 };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Work out per-subject results, SGPA (per semester) and CGPA (overall) for a student.
 * A subject's percentage = total marks obtained / total maximum marks over all its exam components.
 */
export async function computeResults(studentId, { semester, subjectIds }: { semester?: number; subjectIds?: any[] } = {}) {
  const settings = await getSettings();
  const marks = await Mark.find({ student: studentId, ...(semester ? { semester } : {}), ...(subjectIds ? { subject: { $in: subjectIds } } : {}) })
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

  // SGPA = sum(credits * grade points) / sum(credits), grouped by semester
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

  // CGPA = credit-weighted average of the semester SGPAs
  let totalCredits = 0;
  let totalWeighted = 0;
  for (const s of semesterResults) {
    totalCredits += s.credits;
    totalWeighted += s.sgpa * s.credits;
  }
  return {
    subjects,
    semesters: semesterResults,
    cgpa: totalCredits ? round2(totalWeighted / totalCredits) : 0,
  };
}

/** Just the CGPA of a student (used for placement eligibility checks). */
export async function cgpaOf(studentId) {
  return (await computeResults(studentId)).cgpa;
}

export { Subject };
