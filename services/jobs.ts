import { Assignment, Submission, Student, Enrollment } from '@/models';
import { connectDB } from '@/lib/mongodb';
import { notifyUsers } from '@/services/notify';
import { logger } from '@/lib/logger';

const HOUR = 60 * 60 * 1000;

/** Notify students who have not submitted an assignment due within the next 24 hours. */
export async function sendDeadlineReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * HOUR);
  const assignments = await Assignment.find({ deadline: { $gt: now, $lte: soon }, reminderSentAt: { $exists: false } });
  let count = 0;
  for (const a of assignments) {
    const enrolled = await Enrollment.find({ subject: a.subject, status: 'enrolled' }).select('student').lean();
    const submitted = new Set((await Submission.find({ assignment: a._id }).select('student').lean()).map((s: any) => String(s.student)));
    const pending = enrolled.filter((e: any) => !submitted.has(String(e.student))).map((e: any) => e.student);
    const students = await Student.find({ _id: { $in: pending }, ...(a.sections?.length ? { section: { $in: a.sections } } : {}) })
      .select('user')
      .lean();
    await notifyUsers(
      students.map((s: any) => s.user),
      {
        title: 'Assignment due soon',
        message: `"${a.title}" is due on ${a.deadline.toLocaleString()}.`,
        type: 'assignment',
        link: '/assignments',
      }
    );
    a.reminderSentAt = now;
    await a.save();
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
      .then(() => sendDeadlineReminders())
      .catch((e) => logger.error('Deadline reminder job failed', e));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, HOUR).unref();
}
