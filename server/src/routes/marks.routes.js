import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate, objectId, z } from '../middleware/validate.js';
import { MARK_TYPES } from '../models/academics-ops.js';
import * as c from '../controllers/marks.controller.js';

const r = Router();
r.use(protect);

const enterSchema = z.object({
  subject: objectId,
  examType: z.enum(MARK_TYPES),
  maxMarks: z.coerce.number().positive('Maximum marks must be greater than 0').max(1000),
  records: z
    .array(z.object({ student: objectId, marksObtained: z.coerce.number().min(0, 'Marks cannot be negative').max(1000), remarks: z.string().trim().max(200).optional() }))
    .min(1, 'Enter marks for at least one student')
    .max(500),
});
const staff = authorize('admin', 'faculty');

r.post('/', staff, validate(enterSchema), c.enter);
r.get('/subject/:subjectId', staff, c.subjectMarks);
r.get('/subject/:subjectId/performance', staff, c.performance);
r.get('/student/:id/results', authorize('admin', 'faculty', 'student', 'parent'), c.studentResults);
r.delete('/:id', staff, c.remove);

export default r;
