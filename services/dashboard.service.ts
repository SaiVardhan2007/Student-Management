// Dashboard numbers for each role (admin, faculty, student). Called by the dashboard routes.
import {
  Student,
  Faculty,
  Department,
  Program,
  Subject,
  AcademicYear,
  Semester,
  Attendance,
  Mark,
  Notice,
  Complaint,
  StudentDocument,
  AuditLog,
  Assignment,
  Submission,
  Exam,
  Enrollment,
  Notification,
  Timetable,
  AttendanceCorrection,
  getSettings,
} from '@/models';
import { ok } from '@/lib/response';
import { facultyProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { summarize } from '@/services/attendance';
import { computeResults, gradeFor } from '@/services/grading';
import { ownStudents } from '@/services/scope';

// Midnight (UTC) of the given day; dates are stored in UTC.
const startOfDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Daily attendance % = (present + late) / (present + late + absent). Excused is ignored.
// Input rows look like { _id: { d: '2025-01-31', s: 'present' }, c: 12 }.
function dailyAttendancePercentages(rows: any[]) {
  const days = new Map<string, { present: number; absent: number }>();
  for (const row of rows) {
    const day = days.get(row._id.d) || { present: 0, absent: 0 };
    if (row._id.s === 'absent') day.absent += row.c;
    else if (row._id.s !== 'excused') day.present += row.c;
    days.set(row._id.d, day);
  }
  return [...days.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    // days with only excused marks have no counted sessions: skip them instead of dividing by zero
    .filter(([, day]) => day.present + day.absent > 0)
    .map(([date, day]) => ({ date, percentage: Math.round((day.present / (day.present + day.absent)) * 1000) / 10 }));
}

export async function admin() {
  const settings = await getSettings();
  const since = new Date(startOfDay().getTime() - 29 * 86400000);
  const [
    totalStudents,
    activeStudents,
    totalFaculty,
    departments,
    programs,
    subjects,
    year,
    semester,
    attendanceDaily,
    marks,
    byDepartment,
    recentStudents,
    recentActivities,
    recentNotices,
    pendingComplaints,
    pendingDocuments,
  ] = await Promise.all([
    Student.countDocuments(),
    Student.countDocuments({ status: 'active' }),
    Faculty.countDocuments({ status: 'active' }),
    Department.countDocuments(),
    Program.countDocuments(),
    Subject.countDocuments({ isActive: true }),
    AcademicYear.findOne({ isCurrent: true }).select('name').lean(),
    Semester.findOne({ isCurrent: true }).select('name number').lean(),
    Attendance.aggregate([
      { $match: { date: { $gte: since } } },
      { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, s: '$status' }, c: { $sum: 1 } } },
    ]),
    Mark.aggregate([{ $group: { _id: '$student', o: { $sum: '$marksObtained' }, m: { $sum: '$maxMarks' } } }]),
    Student.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'd' } },
      { $unwind: '$d' },
      { $project: { _id: 0, name: '$d.code', count: 1 } },
      { $sort: { count: -1 } },
    ]),
    Student.find().sort({ createdAt: -1 }).limit(5).select('studentId firstName lastName createdAt status').populate('program', 'code').lean(),
    AuditLog.find().sort({ timestamp: -1 }).limit(8).lean(),
    Notice.find().sort({ publishDate: -1 }).limit(4).select('title priority publishDate').lean(),
    Complaint.countDocuments({ status: { $in: ['open', 'assigned', 'in_progress'] } }),
    StudentDocument.countDocuments({ status: 'pending' }),
  ]);

  const attendance = dailyAttendancePercentages(attendanceDaily);

  // count how many students fall in each grade, based on their overall marks percentage
  const gradeCounts: Record<string, number> = {};
  for (const student of marks) {
    const percent = student.m ? (student.o / student.m) * 100 : 0;
    const grade = gradeFor(percent, settings.gradeScale).grade;
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
  }
  // highest grade first, whatever order the scale is stored in
  const performance = [...settings.gradeScale]
    .sort((a: any, b: any) => b.minPercent - a.minPercent)
    .map((g: any) => ({ grade: g.grade, count: gradeCounts[g.grade] || 0 }));

  return ok({
    counts: { totalStudents, activeStudents, totalFaculty, departments, programs, subjects, pendingComplaints, pendingDocuments },
    currentYear: year,
    currentSemester: semester,
    attendance,
    performance,
    studentsByDepartment: byDepartment,
    recentStudents,
    recentActivities,
    recentNotices,
    threshold: settings.attendanceThreshold,
  });
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Submissions (for these subjects' assignments) that are not evaluated yet.
async function countPendingEvaluations(subjectIds: any[]) {
  const assignments = await Assignment.find({ subject: { $in: subjectIds } })
    .select('_id')
    .lean();
  const assignmentIds = assignments.map((a: any) => a._id);
  return Submission.countDocuments({ assignment: { $in: assignmentIds }, status: { $ne: 'evaluated' } });
}

export async function faculty(ctx: Ctx) {
  const f = await facultyProfile(ctx);
  const subjects = await Subject.find({ faculty: f._id }).select('code name semester').lean();
  const subjectIds = subjects.map((s: any) => s._id);
  const [students, pendingEvaluations, upcomingExams, pendingCorrections, todayClasses] = await Promise.all([
    Enrollment.distinct('student', { subject: { $in: subjectIds }, status: 'enrolled' }),
    countPendingEvaluations(subjectIds),
    Exam.find({ isPublished: true, date: { $gte: startOfDay() }, $or: [{ invigilators: f._id }, { subject: { $in: subjectIds } }] })
      .sort({ date: 1 })
      .limit(5)
      .populate('subject', 'code name')
      .lean(),
    AttendanceCorrection.countDocuments({ subject: { $in: subjectIds }, status: 'pending' }),
    Timetable.find({ faculty: f._id, day: DAY_NAMES[new Date().getDay()] })
      .sort({ startTime: 1 })
      .populate('subject', 'code name')
      .populate('section', 'name')
      .lean(),
  ]);
  return ok({ subjects, studentCount: students.length, pendingEvaluations, pendingCorrections, upcomingExams, todayClasses });
}

export async function student(ctx: Ctx) {
  const students = await ownStudents(ctx);
  // parents can have several children; others only have one student
  const s = ctx.query.student ? students.find((x: any) => String(x._id) === String(ctx.query.student)) : students[0];
  if (!s) return ok(null);
  const [attendance, results, subjectIds] = await Promise.all([
    summarize(s._id),
    computeResults(s._id),
    Enrollment.distinct('subject', { student: s._id, status: 'enrolled' }),
  ]);
  const now = new Date();
  const [assignments, submissions, exams, unread] = await Promise.all([
    Assignment.find({ subject: { $in: subjectIds }, deadline: { $gt: now }, $or: [{ sections: { $size: 0 } }, { sections: s.section }] })
      .sort({ deadline: 1 })
      .limit(10)
      .populate('subject', 'code name')
      .lean(),
    Submission.find({ student: s._id }).select('assignment').lean(),
    Exam.find({ isPublished: true, program: s.program, semester: s.semester, date: { $gte: startOfDay() } })
      .sort({ date: 1 })
      .limit(5)
      .populate('subject', 'code name')
      .lean(),
    Notification.countDocuments({ user: ctx.user._id, isRead: false }),
  ]);
  // an assignment is pending if the student has not submitted anything for it
  const submittedIds = new Set(submissions.map((x: any) => String(x.assignment)));
  const pending = assignments.filter((a: any) => !submittedIds.has(String(a._id)));
  return ok({
    student: { _id: s._id, name: `${s.firstName} ${s.lastName}`, studentId: s.studentId, semester: s.semester },
    attendance: { overall: attendance.overall, threshold: attendance.threshold, subjects: attendance.subjects },
    cgpa: results.cgpa,
    semesters: results.semesters,
    pendingAssignments: pending,
    upcomingExams: exams,
    unreadNotifications: unread,
  });
}
