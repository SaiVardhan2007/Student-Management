// Background job: reminds students about assignments due soon. Started once from instrumentation.ts.
import { Assignment, Submission, Student, Enrollment } from '@/models';
import { connectDB } from '@/lib/mongodb';
import { notifyUsers } from '@/services/notify';
import { logger } from '@/lib/logger';
import { announceDueNotices } from '@/services/notice.service';

const HOUR = 60 * 60 * 1000;

/** Notify students who have not submitted an assignment due within the next 24 hours. */
export async function sendDeadlineReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * HOUR);
  const candidates = await Assignment.find({ deadline: { $gt: now, $lte: soon }, reminderSentAt: { $exists: false } }).select('_id').lean();
  let count = 0; // total students reminded
  for (const c of candidates) {
    // Claim the assignment atomically so overlapping job runs never remind twice
    const a = await Assignment.findOneAndUpdate({ _id: c._id, reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: now } });
    if (!a) continue;
    const enrolled = await Enrollment.find({ subject: a.subject, status: 'enrolled' }).select('student').lean();
    const submissions = await Submission.find({ assignment: a._id }).select('student').lean();
    const submittedIds = new Set(submissions.map((s: any) => String(s.student)));
    const pendingIds = enrolled.filter((e: any) => !submittedIds.has(String(e.student))).map((e: any) => e.student);

    // If the assignment is only for some sections, limit reminders to those sections
    const studentFilter: Record<string, any> = { _id: { $in: pendingIds }, status: 'active' };
    if (a.sections?.length) studentFilter.section = { $in: a.sections };
    const students = await Student.find(studentFilter).select('user').lean();
    await notifyUsers(
      students.map((s: any) => s.user),
      {
        title: 'Assignment due soon',
        message: `"${a.title}" is due on ${a.deadline.toLocaleString()}.`,
        type: 'assignment',
        link: '/assignments',
      }
    );
    count += students.length;
  }
  return count;
}

/** Start the hourly reminder job once per server process (called from instrumentation.ts). */
export function startJobs() {
  const g = globalThis as unknown as { __jobsStarted?: boolean };
  if (g.__jobsStarted || process.env.NODE_ENV === 'test') return;
  g.__jobsStarted = true;
  const run = () =>
    connectDB()
      .then(() => Promise.all([sendDeadlineReminders(), announceDueNotices()]))
      .catch((e) => logger.error('Deadline reminder job failed', e));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, HOUR).unref();
}
