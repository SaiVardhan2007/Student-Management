// Fee service: fee structures (templates), fee records per student, admin-recorded payments, Razorpay online payments and receipts.
import crypto from 'crypto';
import { Fee, FeeStructure, Student, Program } from '@/models';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { createRazorpayOrder, razorpayConfig, verifyPaymentSignature } from '@/lib/razorpay';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import type { Ctx } from '@/lib/context';
import { ownStudentIds } from '@/services/access';
import { notifyStudents, notifyUsers } from '@/services/notify';
import { audit } from '@/services/audit';

const POPULATE = [
  { path: 'student', select: 'studentId firstName lastName' },
  { path: 'structure', select: 'name semester' },
];

const cents = (n: number) => Math.round(n * 100);

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
// Turn the ?status= query into a MongoDB filter on amountPaid / amountDue / dueDate.
function statusFilter(q: Record<string, any>) {
  const now = new Date();
  const s = q.status;
  if (s === 'paid') return { $expr: { $gte: ['$amountPaid', '$amountDue'] } };
  if (s === 'partial') return { $expr: { $and: [{ $gt: ['$amountPaid', 0] }, { $lt: ['$amountPaid', '$amountDue'] }] } };
  if (s === 'overdue') return { $expr: { $lt: ['$amountPaid', '$amountDue'] }, dueDate: { $lt: now } };
  if (s === 'pending') return { amountPaid: 0, dueDate: { $gte: now } };
  return {};
}

// Status shown to the user: paid, partial, overdue (unpaid and past due date) or pending.
function feeStatus(fee: { amountDue: number; amountPaid: number; dueDate: Date }) {
  if (fee.amountPaid >= fee.amountDue) return 'paid';
  if (fee.amountPaid > 0) return 'partial';
  if (new Date(fee.dueDate) < new Date()) return 'overdue';
  return 'pending';
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
    select: '-gatewayOrders',
  });
  const fees = items.map((fee) => ({
    ...fee,
    amountPending: Math.max(fee.amountDue - fee.amountPaid, 0),
    status: feeStatus(fee),
  }));
  return ok(fees, 'OK', 200, meta);
}

/** Admin records an offline payment (cash, card machine, bank transfer). Students pay online through Razorpay instead. */
export async function pay(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const filter: Record<string, any> = { _id: ctx.params.id };
  if (ctx.user.role === 'student') filter.student = { $in: await ownStudentIds(ctx) };
  const fee = await Fee.findOne(filter);
  if (!fee) throw AppError.notFound('Fee record not found');
  // work in whole cents so float noise (0.1 + 0.2) cannot block or over-accept a payment
  const amountCents = cents(Number(ctx.body.amount));
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw AppError.badRequest('Amount must be greater than zero');
  const amount = amountCents / 100;
  const pendingCents = cents(fee.amountDue) - cents(fee.amountPaid);
  if (pendingCents < 1) throw AppError.conflict('This fee is already fully paid');
  if (amountCents > pendingCents) throw AppError.badRequest(`Amount exceeds the pending balance (${pendingCents / 100})`);
  // random part makes receipt numbers hard to guess
  const receiptNo = `RCT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  // One atomic update: the balance check is part of the query, so a double POST cannot record the payment twice
  const updated = await Fee.findOneAndUpdate(
    { ...filter, $expr: { $lte: [{ $add: ['$amountPaid', amount] }, { $add: ['$amountDue', 0.005] }] } },
    {
      $inc: { amountPaid: amount },
      $push: {
        payments: {
          amount,
          method: ctx.body.method,
          receiptNo,
          recordedBy: ctx.user._id,
        },
      },
    },
    { new: true }
  );
  if (!updated) throw AppError.conflict('The balance changed or the fee is already paid; please refresh and try again');
  if (ctx.user.role === 'admin') {
    const s = await Student.findById(updated.student).select('user');
    if (s?.user)
      await notifyUsers([s.user], {
        title: 'Payment recorded',
        message: `${ctx.body.amount} received for ${updated.title}. Receipt ${receiptNo}`,
        type: 'fee',
        link: '/fees',
      });
  }
  await audit(ctx, 'FEE_PAYMENT', 'Fee', updated._id, { amount: ctx.body.amount, receiptNo });
  return ok({ fee: updated, receiptNo }, 'Payment recorded');
}

/** Show one payment receipt. Students and parents can only see their own. */
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

// ---- admin: set what a student owes
export async function createFee(ctx: Ctx) {
  if (!(await Student.exists({ _id: ctx.body.student }))) throw AppError.badRequest('Student not found');
  const fee = await Fee.create(ctx.body);
  const s = await Student.findById(fee.student).select('user');
  if (s?.user)
    await notifyUsers([s.user], {
      title: `Fee due: ${fee.title}`,
      message: `Amount ${fee.amountDue}, due ${fee.dueDate.toDateString()}`,
      type: 'fee',
      link: '/fees',
    });
  await audit(ctx, 'FEE_CREATED', 'Fee', fee._id, { amountDue: fee.amountDue });
  return created(fee, 'Fee created');
}

/** Change the total, title or due date of one student's fee. The total cannot go below what is already paid. */
export async function updateFee(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const fee = await Fee.findById(ctx.params.id);
  if (!fee) throw AppError.notFound('Fee record not found');
  if (ctx.body.amountDue !== undefined && cents(ctx.body.amountDue) < cents(fee.amountPaid))
    throw AppError.badRequest(`Amount cannot be less than what is already paid (${fee.amountPaid})`);
  fee.set(ctx.body);
  await fee.save();
  await audit(ctx, 'FEE_UPDATED', 'Fee', fee._id, ctx.body);
  return ok(fee, 'Fee updated');
}

export async function removeFee(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const fee = await Fee.findById(ctx.params.id);
  if (!fee) throw AppError.notFound('Fee record not found');
  if (fee.amountPaid > 0) throw AppError.conflict('Payments exist against this fee; it cannot be deleted');
  await fee.deleteOne();
  await audit(ctx, 'FEE_DELETED', 'Fee', fee._id);
  return ok(null, 'Fee deleted');
}

// ---- Razorpay online payment
/** Step 1: the student chooses an amount; we open a Razorpay order for it and return what Checkout needs. */
export async function razorpayOrder(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const fee = await Fee.findOne({ _id: ctx.params.id, student: { $in: await ownStudentIds(ctx) } });
  if (!fee) throw AppError.notFound('Fee record not found');
  const { keyId } = razorpayConfig();
  const amountCents = cents(Number(ctx.body.amount));
  const pendingCents = cents(fee.amountDue) - cents(fee.amountPaid);
  if (pendingCents < 1) throw AppError.conflict('This fee is already fully paid');
  if (amountCents > pendingCents) throw AppError.badRequest(`Amount exceeds the pending balance (${pendingCents / 100})`);
  const amount = amountCents / 100;
  const order = await createRazorpayOrder(amount, `fee_${fee._id}`, { fee: String(fee._id), student: String(fee.student) });
  await Fee.updateOne({ _id: fee._id }, { $push: { gatewayOrders: { orderId: order.id, amount } } });
  return ok({ keyId, orderId: order.id, amount: order.amount, currency: order.currency, title: fee.title });
}

/**
 * Record the Razorpay payment for an order we opened. Safe to call twice (browser verify + webhook):
 * a payment id is only ever recorded once. The order's own amount is used, never one sent by the caller.
 */
export async function recordGatewayPayment(orderId: string, paymentId: string, ownerFilter: Record<string, any> = {}) {
  const fee = await Fee.findOne({ ...ownerFilter, 'gatewayOrders.orderId': orderId });
  if (!fee) throw AppError.notFound('Payment order not found');
  const done = fee.payments.find((p: any) => p.gatewayPaymentId === paymentId);
  if (done) return { fee, receiptNo: done.receiptNo, duplicate: true };
  const order = fee.gatewayOrders.find((o: any) => o.orderId === orderId);
  const receiptNo = `RCT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  // The money has already moved, so no balance check: the payment is always recorded. Filter on the payment id
  // so two racing requests cannot both push it.
  const updated = await Fee.findOneAndUpdate(
    { _id: fee._id, 'payments.gatewayPaymentId': { $ne: paymentId } },
    {
      $inc: { amountPaid: order.amount },
      $push: {
        payments: { amount: order.amount, method: 'razorpay', receiptNo, gatewayOrderId: orderId, gatewayPaymentId: paymentId },
      },
    },
    { new: true }
  );
  if (!updated) {
    const again = await Fee.findById(fee._id);
    const p = again?.payments.find((x: any) => x.gatewayPaymentId === paymentId);
    return { fee: again, receiptNo: p?.receiptNo, duplicate: true };
  }
  const s = await Student.findById(updated.student).select('user');
  if (s?.user)
    await notifyUsers([s.user], {
      title: 'Payment received',
      message: `${order.amount} received for ${updated.title}. Receipt ${receiptNo}`,
      type: 'fee',
      link: '/fees',
    });
  await audit(undefined, 'FEE_PAYMENT_RAZORPAY', 'Fee', updated._id, { amount: order.amount, receiptNo, paymentId });
  return { fee: updated, receiptNo, duplicate: false };
}

/** Step 2: Checkout finished in the browser; check Razorpay's signature, then record the payment. */
export async function razorpayVerify(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = ctx.body;
  if (!verifyPaymentSignature(orderId, paymentId, sig)) throw AppError.badRequest('Payment verification failed');
  const { fee, receiptNo } = await recordGatewayPayment(orderId, paymentId, {
    _id: ctx.params.id,
    student: { $in: await ownStudentIds(ctx) },
  });
  return ok({ fee, receiptNo }, 'Payment successful');
}

/** Razorpay webhook (payment.captured): records payments even if the student closed the browser early. */
export async function razorpayWebhook(event: any) {
  if (event?.event !== 'payment.captured') return;
  const p = event.payload?.payment?.entity;
  if (!p?.order_id || !p?.id) return;
  await recordGatewayPayment(p.order_id, p.id);
}
