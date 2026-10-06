import crypto from 'crypto';
import { Fee, FeeStructure, Student, Program } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import type { Ctx } from '@/lib/context';
import { ownStudentIds } from '@/services/access';
import { notifyStudents, notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';

const POPULATE = [
  { path: 'student', select: 'studentId firstName lastName' },
  { path: 'structure', select: 'name semester' },
];

// ---- structures
export async function listStructures(ctx: Ctx) {
  const { items, meta } = await paginate(FeeStructure, ctx, {
    filter: filtersFromQuery(ctx.query, { program: 'id', semester: 'number' }),
    searchFields: ['name'],
    allowedSort: ['dueDate', 'amount', 'name'],
    defaultSort: { dueDate: -1 },
    populate: { path: 'program', select: 'name code' },
  });
  return ok(items, 'OK', 200, meta);
}

export async function createStructure(ctx: Ctx) {
  if (!(await Program.exists({ _id: ctx.body.program }))) throw AppError.badRequest('Program not found');
  const st = await FeeStructure.create(ctx.body);
  await audit(ctx, 'FEE_STRUCTURE_CREATED', 'FeeStructure', st._id);
  return created(st, 'Fee structure created');
}

export async function deleteStructure(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const st = await FeeStructure.findById(ctx.params.id);
  if (!st) throw AppError.notFound('Fee structure not found');
  if (await Fee.exists({ structure: st._id, amountPaid: { $gt: 0 } }))
    throw AppError.conflict('Payments exist against this structure; it cannot be deleted');
  await Fee.deleteMany({ structure: st._id });
  await st.deleteOne();
  return ok(null, 'Fee structure deleted');
}

/** Generate fee records for all active students of the structure's program + semester. */
export async function assignStructure(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const st = await FeeStructure.findById(ctx.params.id);
  if (!st) throw AppError.notFound('Fee structure not found');
  const students = await Student.find({ program: st.program, semester: st.semester, status: 'active' }).select('_id').lean();
  if (!students.length) throw AppError.badRequest('No active students match this program and semester');
  const out = await Fee.bulkWrite(
    students.map((s: any) => ({
      updateOne: {
        filter: { student: s._id, structure: st._id },
        update: {
          $setOnInsert: { student: s._id, structure: st._id, title: st.name, amountDue: st.amount, dueDate: st.dueDate, amountPaid: 0 },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  if (out.upsertedCount)
    await notifyStudents(
      { program: st.program, semester: st.semester },
      { title: `Fee due: ${st.name}`, message: `Amount ${st.amount}, due ${st.dueDate.toDateString()}`, type: 'fee', link: '/fees' }
    );
  await audit(ctx, 'FEES_ASSIGNED', 'FeeStructure', st._id, { created: out.upsertedCount });
  return ok({ created: out.upsertedCount, existing: students.length - out.upsertedCount }, 'Fees assigned');
}

// ---- records
function statusFilter(q: Record<string, any>) {
  const now = new Date();
  const s = q.status;
  if (s === 'paid') return { $expr: { $gte: ['$amountPaid', '$amountDue'] } };
  if (s === 'partial') return { $expr: { $and: [{ $gt: ['$amountPaid', 0] }, { $lt: ['$amountPaid', '$amountDue'] }] } };
  if (s === 'overdue') return { $expr: { $lt: ['$amountPaid', '$amountDue'] }, dueDate: { $lt: now } };
  if (s === 'pending') return { amountPaid: 0, dueDate: { $gte: now } };
  return {};
}

export async function list(ctx: Ctx) {
  const filter: Record<string, any> = { ...filtersFromQuery(ctx.query, { student: 'id', structure: 'id' }), ...statusFilter(ctx.query) };
  if (ctx.user.role !== 'admin') {
    if (ctx.user.role === 'faculty') throw AppError.forbidden();
    filter.student = { $in: await ownStudentIds(ctx) };
  }
  const { items, meta } = await paginate(Fee, ctx, {
    filter,
    allowedSort: ['dueDate', 'amountDue', 'createdAt'],
    defaultSort: { dueDate: -1 },
    populate: POPULATE,
  });
  return ok(
    items.map((f) => ({
      ...f,
      amountPending: Math.max(f.amountDue - f.amountPaid, 0),
      status: f.amountPaid >= f.amountDue ? 'paid' : f.amountPaid > 0 ? 'partial' : new Date(f.dueDate) < new Date() ? 'overdue' : 'pending',
    })),
    'OK',
    200,
    meta
  );
}

/** Simulated payment: no real gateway — records the payment and issues a receipt number. */
export async function pay(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const filter: Record<string, any> = { _id: ctx.params.id };
  if (ctx.user.role === 'student') filter.student = { $in: await ownStudentIds(ctx) };
  const fee = await Fee.findOne(filter);
  if (!fee) throw AppError.notFound('Fee record not found');
  const pending = fee.amountDue - fee.amountPaid;
  if (pending <= 0) throw AppError.conflict('This fee is already fully paid');
  if (ctx.body.amount > pending) throw AppError.badRequest(`Amount exceeds the pending balance (${pending})`);
  const receiptNo = `RCT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  fee.payments.push({
    amount: ctx.body.amount,
    method: ctx.user.role === 'student' ? 'simulated' : ctx.body.method,
    receiptNo,
    recordedBy: ctx.user._id,
  });
  fee.amountPaid += ctx.body.amount;
  await fee.save();
  if (ctx.user.role === 'admin') {
    const s = await Student.findById(fee.student).select('user');
    if (s?.user)
      await notifyUsers([s.user], {
        title: 'Payment recorded',
        message: `${ctx.body.amount} received for ${fee.title}. Receipt ${receiptNo}`,
        type: 'fee',
        link: '/fees',
      });
  }
  await audit(ctx, 'FEE_PAYMENT', 'Fee', fee._id, { amount: ctx.body.amount, receiptNo });
  return ok({ fee, receiptNo }, 'Payment recorded');
}

export async function receipt(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const filter: Record<string, any> = { _id: ctx.params.id };
  if (ctx.user.role === 'faculty') throw AppError.forbidden();
  if (ctx.user.role !== 'admin') filter.student = { $in: await ownStudentIds(ctx) };
  const fee = await Fee.findOne(filter).populate('student', 'studentId firstName lastName').lean<any>();
  const p = fee?.payments.find((x: any) => x.receiptNo === ctx.params.receiptNo);
  if (!p) throw AppError.notFound('Receipt not found');
  return ok({
    receiptNo: p.receiptNo,
    paidAt: p.paidAt,
    amount: p.amount,
    method: p.method,
    fee: fee.title,
    amountDue: fee.amountDue,
    amountPaid: fee.amountPaid,
    student: fee.student,
  });
}
