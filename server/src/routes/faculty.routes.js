import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate, objectId, z } from '../middleware/validate.js';
import { createFacultySchema, updateFacultySchema } from '../validators/people.js';
import * as c from '../controllers/faculty.controller.js';

const r = Router();
r.use(protect);

const assignSchema = z.object({ subjects: z.array(objectId), sections: z.array(objectId).optional() });

r.get('/me', authorize('faculty'), c.getMe);
r.get('/export', authorize('admin'), c.exportCsv);
r.get('/', authorize('admin', 'faculty'), c.list);
r.post('/', authorize('admin'), validate(createFacultySchema), c.create);
r.get('/:id', authorize('admin', 'faculty'), c.get);
r.put('/:id', authorize('admin'), validate(updateFacultySchema), c.update);
r.patch('/:id', authorize('admin'), validate(updateFacultySchema), c.update);
r.put('/:id/subjects', authorize('admin'), validate(assignSchema), c.assignSubjects);
r.post('/:id/activate', authorize('admin'), c.activate);
r.delete('/:id', authorize('admin'), c.deactivate);

export default r;
