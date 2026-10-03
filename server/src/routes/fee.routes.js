import { Router } from 'express';
import crypto from 'crypto';
import { protect, authorize } from '../middleware/auth.js';
import { validate, z, objectId, dateField } from '../middleware/validate.js';
import { Fee, FeeStructure, Student, Program } from '../models/index.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { ownStudentIds } from '../services/access.js';
import { notifyStudents, notifyUsers } from '../services/notify.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(protect);
const admin = authorize('admin');

const structureSchema = z.object({ name: z.string().trim().min(2).max(150), program: objectId, semester: z.coerce.number().int().min(1).max(12), amount: z.coerce.number().positive().max(10000000), dueDate: dateField, description: z.string().trim().max(500).optional() });
const paySchema = z.object({ amount: z.coerce.number().positive(), method: z.enum(['cash', 'card', 'upi', 'netbanking', 'simulated']).default('simulated') });
const POPULATE = [{ path: 'student', select: 'studentId firstName lastName' }, { path: 'structure', select: 'name semester' }];

// ---- structures
r.get('/structures', authorize('admin'), asyncHandler(async (req, res) => {
  const { items, meta } = await paginate(FeeStructure, req, { filter: filtersFromQuery(req.query, { program: 'id', semester: 'number' }), searchFields: ['name'], allowedSort: ['dueDate', 'amount', 'name'], defaultSort: { dueDate: -1 }, populate: { path: 'program', select: 'name code' } });
  ok(res, items, 'OK', 200, meta);
}));

r.post('/structures', admin, validate(structureSchema), asyncHandler(async (req, res) => {
  if (!(await Program.exists({ _id: req.body.program }))) throw AppError.badRequest('Program not found');
  const st = await FeeStructure.create(req.body);
  await audit(req, 'FEE_STRUCTURE_CREATED', 'FeeStructure', st._id);
  created(res, st, 'Fee structure created');
}));

r.delete('/structures/:id', admin, asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const st = await FeeStructure.findById(req.params.id);
  if (!st) throw AppError.notFound('Fee structure not found');
  if (await Fee.exists({ structure: st._id, amountPaid: { $gt: 0 } })) throw AppError.conflict('Payments exist against this structure; it cannot be deleted');
  await Fee.deleteMany({ structure: st._id });
  await st.deleteOne();
  ok(res, null, 'Fee structure deleted');
}));

/** Generate fee records for all active students of the structure's program + semester. */
r.post('/structures/:id/assign', admin, asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const st = await FeeStructure.findById(req.params.id);
  if (!st) throw AppError.notFound('Fee structure not found');
  const students = await Student.find({ program: st.program, semester: st.semester, status: 'active' }).select('_id').lean();
  if (!students.length) throw AppError.badRequest('No active students match this program and semester');
  const out = await Fee.bulkWrite(students.map((s) => ({ updateOne: { filter: { student: s._id, structure: st._id }, update: { $setOnInsert: { student: s._id, structure: st._id, title: st.name, amountDue: st.amount, dueDate: st.dueDate, amountPaid: 0 } }, upsert: true } })), { ordered: false });
  if (out.upsertedCount) await notifyStudents({ program: st.program, semester: st.semester }, { title: `Fee due: ${st.name}`, message: `Amount ${st.amount}, due ${st.dueDate.toDateString()}`, type: 'fee', link: '/fees' });
  await audit(req, 'FEES_ASSIGNED', 'FeeStructure', st._id, { created: out.upsertedCount });
  ok(res, { created: out.upsertedCount, existing: students.length - out.upsertedCount }, 'Fees assigned');
}));

// ---- records
async function statusFilter(q) {
  const now = new Date();
  const s = q.status;
  if (s === 'paid') return { $expr: { $gte: ['$amountPaid', '$amountDue'] } };
  if (s === 'partial') return { $expr: { $and: [{ $gt: ['$amountPaid', 0] }, { $lt: ['$amountPaid', '$amountDue'] }] } };
  if (s === 'overdue') return { $expr: { $lt: ['$amountPaid', '$amountDue'] }, dueDate: { $lt: now } };
  if (s === 'pending') return { amountPaid: 0, dueDate: { $gte: now } };
  return {};
}

r.get('/', asyncHandler(async (req, res) => {
  const filter = { ...filtersFromQuery(req.query, { student: 'id', structure: 'id' }), ...(await statusFilter(req.query)) };
  if (req.user.role !== 'admin') {
    if (req.user.role === 'faculty') throw AppError.forbidden();
    const ids = await ownStudentIds(req);
    filter.student = { $in: ids };
  }
  const { items, meta } = await paginate(Fee, req, { filter, allowedSort: ['dueDate', 'amountDue', 'createdAt'], defaultSort: { dueDate: -1 }, populate: POPULATE });
  ok(res, items.map((f) => ({ ...f, amountPending: Math.max(f.amountDue - f.amountPaid, 0), status: f.amountPaid >= f.amountDue ? 'paid' : f.amountPaid > 0 ? 'partial' : new Date(f.dueDate) < new Date() ? 'overdue' : 'pending' })), 'OK', 200, meta);
}));

/** Simulated payment: no real gateway — records the payment and issues a receipt number. */
r.post('/:id/pay', authorize('admin', 'student'), validate(paySchema), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const filter = { _id: req.params.id };
  if (req.user.role === 'student') filter.student = { $in: await ownStudentIds(req) };
  const fee = await Fee.findOne(filter);
  if (!fee) throw AppError.notFound('Fee record not found');
  const pending = fee.amountDue - fee.amountPaid;
  if (pending <= 0) throw AppError.conflict('This fee is already fully paid');
  if (req.body.amount > pending) throw AppError.badRequest(`Amount exceeds the pending balance (${pending})`);
  const receiptNo = `RCT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  fee.payments.push({ amount: req.body.amount, method: req.user.role === 'student' ? 'simulated' : req.body.method, receiptNo, recordedBy: req.user._id });
  fee.amountPaid += req.body.amount;
  await fee.save();
  if (req.user.role === 'admin') {
    const s = await Student.findById(fee.student).select('user');
    if (s?.user) await notifyUsers([s.user], { title: 'Payment recorded', message: `${req.body.amount} received for ${fee.title}. Receipt ${receiptNo}`, type: 'fee', link: '/fees' });
  }
  await audit(req, 'FEE_PAYMENT', 'Fee', fee._id, { amount: req.body.amount, receiptNo });
  ok(res, { fee, receiptNo }, 'Payment recorded');
}));

r.get('/:id/receipt/:receiptNo', asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const filter = { _id: req.params.id };
  if (req.user.role === 'faculty') throw AppError.forbidden();
  if (req.user.role !== 'admin') filter.student = { $in: await ownStudentIds(req) };
  const fee = await Fee.findOne(filter).populate('student', 'studentId firstName lastName').lean();
  const p = fee?.payments.find((x) => x.receiptNo === req.params.receiptNo);
  if (!p) throw AppError.notFound('Receipt not found');
  ok(res, { receiptNo: p.receiptNo, paidAt: p.paidAt, amount: p.amount, method: p.method, fee: fee.title, amountDue: fee.amountDue, amountPaid: fee.amountPaid, student: fee.student });
}));

export default r;
