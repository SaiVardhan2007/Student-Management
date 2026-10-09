// MongoDB collections (Mongoose models) for campus life: notices, notifications, materials, calendar, documents,
// complaints, achievements, the audit log and settings.
import mongoose from 'mongoose';
import { registerModel } from './register';
import { fileSchema } from './academics-ops';
import { settingsCache } from '@/lib/doc-cache';

const { Schema } = mongoose;
// Shortcut for a field that stores the _id of a document in another collection.
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

export const NOTICE_AUDIENCES = ['all', 'students', 'faculty', 'parents'];

// An announcement. Department/program/year/section optionally narrow who it is for.
const noticeSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 5000 },
    audience: { type: String, enum: NOTICE_AUDIENCES, default: 'all' },
    department: oid('Department'),
    program: oid('Program'),
    year: { type: Number, min: 1, max: 8 },
    section: oid('Section'),
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    publishDate: { type: Date, default: Date.now, index: true },
    expiryDate: Date,
    attachment: fileSchema,
    announcedAt: Date, // set once the notification fan-out has been sent
    createdBy: oid('User', { required: true }),
  },
  { timestamps: true }
);
noticeSchema.index({ publishDate: -1, expiryDate: 1 });
export const Notice = registerModel('Notice', noticeSchema);

// A short message shown to one user (bell icon).
const notificationSchema = new Schema(
  {
    user: oid('User', { required: true }),
    title: { type: String, required: true },
    message: String,
    type: {
      type: String,
      enum: ['assignment', 'attendance', 'marks', 'exam', 'notice', 'complaint', 'document', 'fee', 'placement', 'general'],
      default: 'general',
    },
    link: String,
    isRead: { type: Boolean, default: false },
    readAt: Date,
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
export const Notification = registerModel('Notification', notificationSchema);

export const MATERIAL_TYPES = ['notes', 'pdf', 'assignment', 'question_paper', 'reference'];

// A study file uploaded for a subject.
const materialSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: String,
    subject: oid('Subject', { required: true, index: true }),
    type: { type: String, enum: MATERIAL_TYPES, default: 'notes' },
    file: { type: fileSchema, required: true },
    uploadedBy: oid('User', { required: true }),
  },
  { timestamps: true }
);
export const Material = registerModel('Material', materialSchema);

// An entry on the academic calendar (holiday, seminar, deadline ...).
const calendarSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: String,
    type: {
      type: String,
      enum: ['exam', 'holiday', 'assignment', 'seminar', 'event', 'deadline'],
      default: 'event',
    },
    startDate: { type: Date, required: true, index: true },
    endDate: Date,
    audience: { type: String, enum: NOTICE_AUDIENCES, default: 'all' },
    createdBy: oid('User'),
  },
  { timestamps: true }
);
export const CalendarEvent = registerModel('CalendarEvent', calendarSchema);

export const DOC_STATUSES = ['pending', 'verified', 'rejected', 'reupload_requested'];

// A certificate or ID file uploaded by a student, to be checked by the admin.
const documentSchema = new Schema(
  {
    student: oid('Student', { required: true, index: true }),
    type: {
      type: String,
      enum: ['certificate', 'marksheet', 'id_proof', 'internship', 'other'],
      default: 'other',
    },
    title: { type: String, required: true, trim: true },
    file: { type: fileSchema, required: true },
    status: { type: String, enum: DOC_STATUSES, default: 'pending', index: true },
    reviewNote: String,
    reviewedBy: oid('User'),
    reviewedAt: Date,
  },
  { timestamps: true }
);
export const StudentDocument = registerModel('StudentDocument', documentSchema);

export const COMPLAINT_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

// A complaint raised by a student, with the replies from staff.
const complaintSchema = new Schema(
  {
    student: oid('Student', { required: true, index: true }),
    category: {
      type: String,
      enum: ['academic', 'administrative', 'hostel', 'library', 'fees', 'infrastructure', 'other'],
      default: 'other',
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 5000 },
    attachment: fileSchema,
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'open', index: true },
    assignedTo: oid('User'),
    responses: [
      {
        by: oid('User'),
        byName: String,
        message: { type: String, maxlength: 2000 },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);
export const Complaint = registerModel('Complaint', complaintSchema);

// A student's achievement (hackathon, certificate ...) waiting for verification.
const achievementSchema = new Schema(
  {
    student: oid('Student', { required: true, index: true }),
    title: { type: String, required: true, trim: true, maxlength: 200 },
    category: {
      type: String,
      enum: ['certification', 'hackathon', 'sports', 'technical', 'cultural', 'other'],
      default: 'other',
    },
    description: String,
    date: Date,
    certificate: fileSchema,
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
    verifiedBy: oid('User'),
    verifiedAt: Date,
  },
  { timestamps: true }
);
export const Achievement = registerModel('Achievement', achievementSchema);

// One row per important action, for tracking who did what. Never updated, so no timestamps/version key.
const auditSchema = new Schema(
  {
    user: oid('User', { index: true }),
    userName: String,
    role: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, index: true },
    entityId: String,
    details: Schema.Types.Mixed,
    ip: String,
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);
export const AuditLog = registerModel('AuditLog', auditSchema);

// Grade scale used until the admin changes it: a student with at least minPercent gets that grade.
const DEFAULT_GRADES = [
  { grade: 'O', minPercent: 90, points: 10 },
  { grade: 'A+', minPercent: 80, points: 9 },
  { grade: 'A', minPercent: 70, points: 8 },
  { grade: 'B+', minPercent: 60, points: 7 },
  { grade: 'B', minPercent: 50, points: 6 },
  { grade: 'C', minPercent: 40, points: 5 },
  { grade: 'F', minPercent: 0, points: 0 },
];

// College-wide settings. Only one row exists; its key is always 'main'.
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'main', unique: true },
    collegeName: { type: String, default: 'My College' },
    logo: String,
    contact: { email: String, phone: String, address: String, website: String },
    // Minimum attendance percentage a student must keep.
    attendanceThreshold: { type: Number, default: 75, min: 0, max: 100 },
    passPercentage: { type: Number, default: 40, min: 0, max: 100 },
    gradeScale: { type: [{ grade: String, minPercent: Number, points: Number, _id: false }], default: DEFAULT_GRADES },
    libraryFinePerDay: { type: Number, default: 2, min: 0 },
    libraryLoanDays: { type: Number, default: 14, min: 1 },
  },
  { timestamps: true }
);
// Any write drops the cached settings (lib/doc-cache.ts).
settingsSchema.post('save', () => settingsCache.clear());
settingsSchema.post(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as any,
  () => settingsCache.clear()
);
export const Settings = registerModel('Settings', settingsSchema);

/** The settings document (cached for a minute; callers may change and save it). */
export async function getSettings() {
  const cached = settingsCache.get(Settings, 'main');
  if (cached) return cached;
  const lean = await Settings.findOne({ key: 'main' }).lean();
  if (!lean) return Settings.create({ key: 'main' });
  settingsCache.set('main', lean);
  return Settings.hydrate(lean);
}
