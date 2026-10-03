import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadSingle, uploadMany } from '../middleware/upload.js';
import { assignmentSchema, assignmentUpdateSchema, submitSchema, evaluateSchema } from '../validators/ops.js';
import * as c from '../controllers/assignment.controller.js';

const r = Router();
r.use(protect);
const staff = authorize('admin', 'faculty');

r.get('/', c.list);
r.post('/', staff, uploadSingle('assignments', 'attachment'), validate(assignmentSchema), c.create);
r.patch('/submissions/:submissionId/evaluate', staff, validate(evaluateSchema), c.evaluate);
r.get('/:id', c.get);
r.patch('/:id', staff, uploadSingle('assignments', 'attachment'), validate(assignmentUpdateSchema), c.update);
r.delete('/:id', staff, c.remove);
r.get('/:id/submissions', staff, c.submissions);
r.post('/:id/submit', authorize('student'), uploadMany('submissions', 'files'), validate(submitSchema), c.submit);

export default r;
