import { Router } from 'express';
import { protect, authorize, facultyProfile } from '../middleware/auth.js';
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
} from '../models/index.js';
import { asyncHandler, ok } from '../utils/http.js';
import { summarize } from '../services/attendance.js';
import { computeResults, gradeFor } from '../services/grading.js';
import { ownStudents } from '../services/scope.js';

const r = Router();
r.use(protect);

const startOfDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

r.get(
  '/admin',
  authorize('admin'),
  asyncHandler(async (_req, res) => {
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
      Student.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('studentId firstName lastName createdAt status')
        .populate('program', 'code')
        .lean(),
      AuditLog.find().sort({ timestamp: -1 }).limit(8).lean(),
      Notice.find().sort({ publishDate: -1 }).limit(4).select('title priority publishDate').lean(),
      Complaint.countDocuments({ status: { $in: ['open', 'assigned', 'in_progress'] } }),
      StudentDocument.countDocuments({ status: 'pending' }),
    ]);

    // daily attendance % (present + late) / (present + late + absent)
    const days = new Map();
    for (const row of attendanceDaily) {
      const e = days.get(row._id.d) || { present: 0, absent: 0 };
      if (row._id.s === 'absent') e.absent += row.c;
      else if (row._id.s !== 'excused') e.present += row.c;
      days.set(row._id.d, e);
    }
    const attendance = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, e]) => ({ date, percentage: Math.round((e.present / (e.present + e.absent)) * 1000) / 10 }));

    const dist = {};
    for (const s of marks) {
      const g = gradeFor(s.m ? (s.o / s.m) * 100 : 0, settings.gradeScale).grade;
      dist[g] = (dist[g] || 0) + 1;
    }
    const performance = settings.gradeScale.map((g) => ({ grade: g.grade, count: dist[g.grade] || 0 }));

    ok(res, {
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
  })
);

r.get(
  '/faculty',
  authorize('faculty'),
  asyncHandler(async (req, res) => {
    const f = await facultyProfile(req);
    const subjects = await Subject.find({ faculty: f._id }).select('code name semester').lean();
    const subjectIds = subjects.map((s) => s._id);
    const [students, pendingEvaluations, upcomingExams, pendingCorrections, todayClasses] = await Promise.all([
      Enrollment.distinct('student', { subject: { $in: subjectIds }, status: 'enrolled' }),
      (async () => {
        const assignments = await Assignment.find({ subject: { $in: subjectIds } })
          .select('_id')
          .lean();
        return Submission.countDocuments({ assignment: { $in: assignments.map((a) => a._id) }, status: { $ne: 'evaluated' } });
      })(),
      Exam.find({ isPublished: true, date: { $gte: startOfDay() }, $or: [{ invigilators: f._id }, { subject: { $in: subjectIds } }] })
        .sort({ date: 1 })
        .limit(5)
        .populate('subject', 'code name')
        .lean(),
      AttendanceCorrection.countDocuments({ subject: { $in: subjectIds }, status: 'pending' }),
      Timetable.find({
        faculty: f._id,
        day: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()],
      })
        .sort({ startTime: 1 })
        .populate('subject', 'code name')
        .populate('section', 'name')
        .lean(),
    ]);
    ok(res, { subjects, studentCount: students.length, pendingEvaluations, pendingCorrections, upcomingExams, todayClasses });
  })
);

r.get(
  '/student',
  authorize('student', 'parent'),
  asyncHandler(async (req, res) => {
    const students = await ownStudents(req);
    const s = req.query.student ? students.find((x) => String(x._id) === String(req.query.student)) : students[0];
    if (!s) return ok(res, null);
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
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);
    const done = new Set(submissions.map((x) => String(x.assignment)));
    const pending = assignments.filter((a) => !done.has(String(a._id)));
    ok(res, {
      student: { _id: s._id, name: `${s.firstName} ${s.lastName}`, studentId: s.studentId, semester: s.semester },
      attendance: { overall: attendance.overall, threshold: attendance.threshold, subjects: attendance.subjects },
      cgpa: results.cgpa,
      semesters: results.semesters,
      pendingAssignments: pending,
      upcomingExams: exams,
      unreadNotifications: unread,
    });
  })
);

export default r;
