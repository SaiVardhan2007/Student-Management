// Helpers other services use to create notifications. They never throw, so a failure here can't break the main action.
import { Notification, Student, User } from '@/models';
import { logger } from '@/lib/logger';

/** Create one in-app notification per user id (duplicates and empty ids are ignored). Never throws. */
export async function notifyUsers(userIds, { title, message, type = 'general', link }) {
  try {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return;
    await Notification.insertMany(
      ids.map((user) => ({ user, title, message, type, link })),
      { ordered: false }
    );
  } catch (err) {
    logger.error('Failed to create notifications', err);
  }
}

/** Notify students (and their linked parents) matching a Student filter. */
export async function notifyStudents(studentFilter, payload) {
  try {
    const students = await Student.find({ ...studentFilter, status: 'active' }).select('user _id').lean();
    const studentUserIds = students.map((s) => s.user);
    const parents = await User.find({ role: 'parent', children: { $in: students.map((s) => s._id) } })
      .select('_id')
      .lean();
    const parentUserIds = parents.map((p) => p._id);
    await notifyUsers([...studentUserIds, ...parentUserIds], payload);
  } catch (err) {
    logger.error('Failed to notify students', err);
  }
}
