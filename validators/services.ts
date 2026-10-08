// Zod schemas that check request data for documents, complaints, achievements, fees, placements, the library
// and settings before the services run.
import { z, objectId, dateField, optionalDate, optionalPhone } from '@/validators/common';
import { COMPLAINT_STATUSES } from '@/models/campus';
import { APPLICATION_STATUSES } from '@/models/extras';

// ---- exams
// Settings for generating the seating plan: seats per room and the seat-number prefix.
export const seatingSchema = z.object({
  // optional: without it everyone sits in one hall; a smaller capacity spreads the class over several rooms
  perRoomCapacity: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(1).max(1000).optional()),
  prefix: z.string().trim().max(5).default('S'),
});

// ---- documents
export const documentUploadSchema = z.object({
  type: z.enum(['certificate', 'marksheet', 'id_proof', 'internship', 'other']).default('other'),
  title: z.string().trim().min(1).max(150),
});
export const documentReviewSchema = z
  .object({ status: z.enum(['verified', 'rejected', 'reupload_requested']), reviewNote: z.string().trim().max(500).optional() })
  // Rejecting or asking for a re-upload needs a note so the student knows why.
  .refine((d) => d.status === 'verified' || d.reviewNote, { message: 'Please add a note explaining the decision', path: ['reviewNote'] });

// ---- complaints
export const complaintCreateSchema = z.object({
  category: z.enum(['academic', 'administrative', 'hostel', 'library', 'fees', 'infrastructure', 'other']).default('other'),
  subject: z.string().trim().min(3, 'Subject is too short').max(200),
  description: z.string().trim().min(10, 'Please describe the issue (min 10 characters)').max(5000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});
export const complaintRespondSchema = z.object({ message: z.string().trim().min(1).max(2000) });
export const complaintUpdateSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES as [string, ...string[]]).optional(),
  assignedTo: objectId.optional(),
});

// ---- achievements
export const achievementCreateSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.enum(['certification', 'hackathon', 'sports', 'technical', 'cultural', 'other']).default('other'),
  description: z.string().trim().max(2000).optional(),
  date: optionalDate,
});
export const achievementVerifySchema = z.object({ status: z.enum(['verified', 'rejected']) });

// ---- fees
export const feeStructureSchema = z.object({
  name: z.string().trim().min(2).max(150),
  program: objectId,
  semester: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().positive().max(10000000),
  dueDate: dateField,
  description: z.string().trim().max(500).optional(),
});
export const feePaySchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(['cash', 'card', 'upi', 'netbanking', 'simulated']).default('simulated'),
});
// admin sets what one student owes
export const feeCreateSchema = z.object({
  student: objectId,
  title: z.string().trim().min(2).max(150),
  amountDue: z.coerce.number().positive().max(10000000),
  dueDate: dateField,
});
export const feeUpdateSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  amountDue: z.coerce.number().positive().max(10000000).optional(),
  dueDate: dateField.optional(),
});
export const razorpayOrderSchema = z.object({ amount: z.coerce.number().positive() });
export const razorpayVerifySchema = z.object({
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

// ---- placements
export const companySchema = z.object({
  name: z.string().trim().min(2).max(150),
  website: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  description: z.string().trim().max(1000).optional(),
});
export const jobSchema = z.object({
  company: objectId,
  title: z.string().trim().min(2).max(150),
  description: z.string().trim().max(3000).optional(),
  location: z.string().trim().max(100).optional(),
  package: z.coerce.number().min(0).max(1000000000).optional(),
  deadline: dateField,
  isPublished: z.boolean().optional(),
  eligibility: z
    .object({
      minCgpa: z.coerce.number().min(0).max(10).default(0),
      programs: z.array(objectId).default([]),
      maxActiveBacklogs: z.coerce.number().int().min(0).default(0),
    })
    .default({}),
});
export const applicationStatusSchema = z.object({ status: z.enum(APPLICATION_STATUSES as [string, ...string[]]) });

// ---- library
export const bookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  authors: z.array(z.string().trim().min(1).max(100)).min(1, 'Add at least one author'),
  isbn: z
    .string()
    .trim()
    .regex(/^[0-9Xx-]{10,17}$/, 'ISBN must be 10–13 digits'), // up to 17 characters allows hyphens
  category: z.string().trim().max(80).optional(),
  totalCopies: z.coerce.number().int().min(1).max(10000),
});
export const issueBookSchema = z.object({ book: objectId, student: objectId });

// ---- settings
// Grade scale rules: at least two grades, one starting at 0%, and no two grades with the same boundary.
const gradeScale = z
  .array(
    z.object({
      grade: z.string().trim().min(1).max(12),
      minPercent: z.coerce.number().min(0).max(100),
      points: z.coerce.number().min(0).max(10),
    })
  )
  .min(2, 'Define at least two grades')
  .refine((g) => g.some((x) => x.minPercent === 0), { message: 'One grade must start at 0%' })
  .refine((g) => new Set(g.map((x) => x.minPercent)).size === g.length, { message: 'Grade boundaries must be unique' });

export const settingsSchema = z.object({
  collegeName: z.string().trim().min(2).max(150).optional(),
  contact: z
    .object({
      email: z.string().trim().email().optional().or(z.literal('')),
      phone: optionalPhone,
      address: z.string().trim().max(300).optional(),
      website: z.string().trim().max(200).optional(),
    })
    .optional(),
  attendanceThreshold: z.coerce.number().min(0).max(100).optional(),
  passPercentage: z.coerce.number().min(0).max(100).optional(),
  gradeScale: gradeScale.optional(),
  libraryFinePerDay: z.coerce.number().min(0).max(1000).optional(),
  libraryLoanDays: z.coerce.number().int().min(1).max(365).optional(),
});
