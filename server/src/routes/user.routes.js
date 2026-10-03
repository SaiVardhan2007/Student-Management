import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema } from '../validators/people.js';
import * as c from '../controllers/user.controller.js';

const r = Router();
r.use(protect, authorize('admin'));

r.get('/', c.list);
r.post('/', validate(createUserSchema), c.create);
r.get('/:id', c.get);
r.patch('/:id', validate(updateUserSchema), c.update);
r.post('/:id/reset-password', c.resetPassword);

export default r;
