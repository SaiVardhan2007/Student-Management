import { Assignment, Submission, Student, Enrollment } from '../models/index.js';
import { notifyUsers } from '../services/notify.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

const HOUR = 60 * 60 * 1000;

/** Notify students who have not submitted an assignment due within the next 24 hours. */
export async function sendDeadlineReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * HOUR);
  const assignments = await Assignment.find({ deadline: { $gt: now, $lte: soon }, reminderSentAt: { $exists: false } });
  let count = 0;
  for (const a of assignments) {
    const enrolled = await Enrollment.find({ subject: a.subject, status: 'enrolled' }).select('student').lean();
    const submitted = new Set((await Submission.find({ assignment: a._id }).select('student').lean()).map((s) => String(s.student)));
    const pending = enrolled.filter((e) => !submitted.has(String(e.student))).map((e) => e.student);
    const students = await Student.find({ _id: { $in: pending }, ...(a.sections?.length ? { section: { $in: a.sections } } : {}) }).select('user').lean();
    await notifyUsers(students.map((s) => s.user), {
      title: 'Assignment due soon',
      message: `"${a.title}" is due on ${a.deadline.toLocaleString()}.`,
      type: 'assignment',
      link: '/assignments',
    });
    a.reminderSentAt = now;
    await a.save();
    count += students.length;
  }
  return count;
}

export function startJobs() {
  if (env.isTest) return;
  const run = () => sendDeadlineReminders().catch((e) => logger.error('Deadline reminder job failed', e));
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, HOUR).unref();
}
