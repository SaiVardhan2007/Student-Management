// Zod schemas that check request data for attendance and marks before the services run.
import { z, objectId, dateField } from '@/validators/common';
import { ATTENDANCE_STATUSES, MARK_TYPES } from '@/models/academics-ops';

const statuses = ATTENDANCE_STATUSES as [string, ...string[]];

// Attendance for many students at once, all for one subject, section and date.
export const markAttendanceSchema = z.object({
  subject: objectId,
  section: objectId,
  date: dateField,
  records: z
    .array(z.object({ student: objectId, status: z.enum(statuses), remarks: z.string().trim().max(300).optional() }))
    .min(1, 'Select at least one student')
    .max(500),
});

export const correctionRequestSchema = z.object({
  attendance: objectId,
  requestedStatus: z.enum(statuses),
  reason: z.string().trim().min(5, 'Please explain the reason (min 5 characters)').max(500),
});
export const correctionReviewSchema = z.object({ status: z.enum(['approved', 'rejected']), reviewNote: z.string().trim().max(500).optional() });

// Marks for many students at once, all for one subject and exam type.
export const enterMarksSchema = z.object({
  subject: objectId,
  examType: z.enum(MARK_TYPES as [string, ...string[]]),
  maxMarks: z.coerce.number().positive('Maximum marks must be greater than 0').max(1000),
  records: z
    .array(
      z.object({
        student: objectId,
        marksObtained: z.coerce.number().min(0, 'Marks cannot be negative').max(1000),
        remarks: z.string().trim().max(200).optional(),
      })
    )
    .min(1, 'Enter marks for at least one student')
    .max(500),
});
