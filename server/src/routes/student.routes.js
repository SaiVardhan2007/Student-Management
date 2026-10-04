import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadImage } from '../middleware/upload.js';
import { createStudentSchema, updateStudentSchema, selfStudentUpdateSchema } from '../validators/people.js';
import * as c from '../controllers/student.controller.js';

const r = Router();
r.use(protect);

r.get('/me', authorize('student'), c.getMe);
r.patch('/me', authorize('student'), validate(selfStudentUpdateSchema), c.updateMe);
r.post(
  '/me/photo',
  authorize('student'),
  uploadImage('photos'),
  (req, _res, next) => {
    req.params.id = 'me';
    next();
  },
  c.uploadPhoto
);

r.get('/export', authorize('admin'), c.exportCsv);
r.get('/', authorize('admin', 'faculty', 'parent'), c.list);
r.post('/', authorize('admin'), validate(createStudentSchema), c.create);
r.get('/:id', authorize('admin', 'faculty', 'student', 'parent'), c.get);
r.get('/:id/enrollments', authorize('admin', 'faculty', 'student', 'parent'), c.enrollments);
r.put('/:id', authorize('admin'), validate(updateStudentSchema), c.update);
r.patch('/:id', authorize('admin'), validate(updateStudentSchema), c.update);
r.post('/:id/photo', authorize('admin'), uploadImage('photos'), c.uploadPhoto);
r.post('/:id/activate', authorize('admin'), c.activate);
r.delete('/:id', authorize('admin'), c.deactivate);

export default r;
