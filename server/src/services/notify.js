import { Notification, Student, User } from '../models/index.js';
import { logger } from '../utils/logger.js';

/** Create in-app notifications for a list of user ids. Never throws. */
export async function notifyUsers(userIds, { title, message, type = 'general', link }) {
  try {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return;
    await Notification.insertMany(ids.map((user) => ({ user, title, message, type, link })), { ordered: false });
  } catch (err) {
    logger.error('Failed to create notifications', err);
  }
}

/** Notify students (and their linked parents) matching a Student filter. */
export async function notifyStudents(studentFilter, payload) {
  try {
    const students = await Student.find({ ...studentFilter, status: 'active' }).select('user _id').lean();
    const ids = students.map((s) => s.user);
    const parents = await User.find({ role: 'parent', children: { $in: students.map((s) => s._id) } })
      .select('_id')
      .lean();
    await notifyUsers([...ids, ...parents.map((p) => p._id)], payload);
  } catch (err) {
    logger.error('Failed to notify students', err);
  }
}
