// MongoDB collections (Mongoose models) for fees, placements and the library.
import mongoose from 'mongoose';
import { registerModel } from './register';

const { Schema } = mongoose;
// Shortcut for a field that stores the _id of a document in another collection.
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

// ---------------- Fees ----------------
// The fee set for a program and semester (the template).
export const FeeStructure = registerModel(
  'FeeStructure',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      program: oid('Program', { required: true, index: true }),
      semester: { type: Number, required: true },
      amount: { type: Number, required: true, min: 0 },
      dueDate: { type: Date, required: true },
      description: String,
    },
    { timestamps: true }
  )
);

// The fee a single student owes, created from a FeeStructure. Payments are stored inside it.
const feeSchema = new Schema(
  {
    student: oid('Student', { required: true, index: true }),
    // empty for a fee an admin created by hand for a single student
    structure: oid('FeeStructure'),
    title: String,
    amountDue: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, required: true },
    payments: [
      {
        amount: Number,
        method: { type: String, enum: ['cash', 'card', 'upi', 'netbanking', 'simulated', 'razorpay'], default: 'simulated' },
        receiptNo: String,
        paidAt: { type: Date, default: Date.now },
        recordedBy: oid('User'),
        // set for Razorpay payments; the unique payment id makes recording idempotent
        gatewayOrderId: String,
        gatewayPaymentId: String,
        _id: false,
      },
    ],
    // Razorpay orders opened for this fee (kept so a verified payment can be matched to its amount)
    gatewayOrders: [
      {
        orderId: String,
        amount: Number,
        createdAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);
// partial: hand-made fees have no structure, so only structure-based fees are unique per student
feeSchema.index({ student: 1, structure: 1 }, { unique: true, partialFilterExpression: { structure: { $exists: true } } });
feeSchema.index({ 'gatewayOrders.orderId': 1 });
// Virtuals are calculated when read and are not stored in the database.
feeSchema.virtual('amountPending').get(function pending(this: any) {
  return Math.max(this.amountDue - this.amountPaid, 0);
});
feeSchema.virtual('status').get(function status(this: any) {
  if (this.amountPaid >= this.amountDue) return 'paid';
  if (this.amountPaid > 0) return 'partial';
  return this.dueDate < new Date() ? 'overdue' : 'pending';
});
feeSchema.set('toJSON', { virtuals: true });
export const Fee = registerModel('Fee', feeSchema);

// ---------------- Placements ----------------
// A company that recruits from the college.
export const Company = registerModel(
  'Company',
  new Schema(
    {
      name: { type: String, required: true, unique: true, trim: true },
      website: String,
      industry: String,
      description: String,
    },
    { timestamps: true }
  )
);

// A job opening posted by a company. 'eligibility' lists who may apply.
const jobSchema = new Schema(
  {
    company: oid('Company', { required: true, index: true }),
    title: { type: String, required: true, trim: true },
    description: String,
    location: String,
    package: { type: Number, min: 0 },
    eligibility: {
      minCgpa: { type: Number, default: 0, min: 0, max: 10 },
      programs: [oid('Program')],
      maxActiveBacklogs: { type: Number, default: 0 },
    },
    deadline: { type: Date, required: true },
    isPublished: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);
export const Job = registerModel('Job', jobSchema);

export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected'];
// One row per student per job. 'history' records every status change.
const applicationSchema = new Schema(
  {
    job: oid('Job', { required: true }),
    student: oid('Student', { required: true }),
    status: { type: String, enum: APPLICATION_STATUSES, default: 'applied' },
    history: [{ status: String, at: { type: Date, default: Date.now }, by: oid('User'), _id: false }],
  },
  { timestamps: true }
);
applicationSchema.index({ job: 1, student: 1 }, { unique: true });
applicationSchema.index({ student: 1 });
export const Application = registerModel('Application', applicationSchema);

// ---------------- Library ----------------
// One row per book title (not per copy).
const bookSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    authors: [String],
    isbn: { type: String, required: true, unique: true, trim: true },
    category: { type: String, trim: true },
    totalCopies: { type: Number, required: true, min: 0 },
    availableCopies: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);
// Text index so books can be searched by title or author.
bookSchema.index({ title: 'text', authors: 'text' });
export const Book = registerModel('Book', bookSchema);

// One row each time a student borrows a book. returnedAt stays empty until it is returned.
const issueSchema = new Schema(
  {
    book: oid('Book', { required: true }),
    student: oid('Student', { required: true, index: true }),
    issuedAt: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    returnedAt: Date,
    fine: { type: Number, default: 0 },
    issuedBy: oid('User'),
  },
  { timestamps: true }
);
issueSchema.index({ book: 1, returnedAt: 1 });
export const BookIssue = registerModel('BookIssue', issueSchema);
