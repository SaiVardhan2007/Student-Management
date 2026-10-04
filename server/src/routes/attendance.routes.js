import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate, objectId, dateField, z } from '../middleware/validate.js';
import { ATTENDANCE_STATUSES } from '../models/academics-ops.js';
import * as c from '../controllers/attendance.controller.js';

const r = Router();
r.use(protect);

const markSchema = z.object({
  subject: objectId,
  section: objectId,
  date: dateField,
  records: z
    .array(z.object({ student: objectId, status: z.enum(ATTENDANCE_STATUSES), remarks: z.string().trim().max(300).optional() }))
    .min(1, 'Select at least one student')
    .max(500),
});
const requestSchema = z.object({
  attendance: objectId,
  requestedStatus: z.enum(ATTENDANCE_STATUSES),
  reason: z.string().trim().min(5, 'Please explain the reason (min 5 characters)').max(500),
});
const reviewSchema = z.object({ status: z.enum(['approved', 'rejected']), reviewNote: z.string().trim().max(500).optional() });

const staff = authorize('admin', 'faculty');

r.get('/classes', staff, c.classes);
r.get('/roster', staff, c.roster);
r.get('/class-report', staff, c.classReport);
r.post('/', staff, validate(markSchema), c.mark);

r.get('/corrections', authorize('admin', 'faculty', 'student', 'parent'), c.listCorrections);
r.post('/corrections', authorize('student'), validate(requestSchema), c.requestCorrection);
r.patch('/corrections/:id', staff, validate(reviewSchema), c.reviewCorrection);

r.get('/student/:id/summary', authorize('admin', 'faculty', 'student', 'parent'), c.studentSummary);
r.get('/student/:id/history', authorize('admin', 'faculty', 'student', 'parent'), c.studentHistory);

export default r;
