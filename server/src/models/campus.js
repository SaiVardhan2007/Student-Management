import mongoose from 'mongoose';
import { fileSchema } from './academics-ops.js';

const { Schema } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

export const NOTICE_AUDIENCES = ['all', 'students', 'faculty', 'parents'];

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
    createdBy: oid('User', { required: true }),
  },
  { timestamps: true }
);
noticeSchema.index({ publishDate: -1, expiryDate: 1 });
export const Notice = mongoose.model('Notice', noticeSchema);

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
export const Notification = mongoose.model('Notification', notificationSchema);

export const MATERIAL_TYPES = ['notes', 'pdf', 'assignment', 'question_paper', 'reference'];

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
export const Material = mongoose.model('Material', materialSchema);

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
export const CalendarEvent = mongoose.model('CalendarEvent', calendarSchema);

export const DOC_STATUSES = ['pending', 'verified', 'rejected', 'reupload_requested'];

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
export const StudentDocument = mongoose.model('StudentDocument', documentSchema);

export const COMPLAINT_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

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
export const Complaint = mongoose.model('Complaint', complaintSchema);

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
export const Achievement = mongoose.model('Achievement', achievementSchema);

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
export const AuditLog = mongoose.model('AuditLog', auditSchema);

const DEFAULT_GRADES = [
  { grade: 'O', minPercent: 90, points: 10 },
  { grade: 'A+', minPercent: 80, points: 9 },
  { grade: 'A', minPercent: 70, points: 8 },
  { grade: 'B+', minPercent: 60, points: 7 },
  { grade: 'B', minPercent: 50, points: 6 },
  { grade: 'C', minPercent: 40, points: 5 },
  { grade: 'F', minPercent: 0, points: 0 },
];

const settingsSchema = new Schema(
  {
    key: { type: String, default: 'main', unique: true },
    collegeName: { type: String, default: 'My College' },
    logo: String,
    contact: { email: String, phone: String, address: String, website: String },
    attendanceThreshold: { type: Number, default: 75, min: 0, max: 100 },
    passPercentage: { type: Number, default: 40, min: 0, max: 100 },
    gradeScale: { type: [{ grade: String, minPercent: Number, points: Number, _id: false }], default: DEFAULT_GRADES },
    libraryFinePerDay: { type: Number, default: 2, min: 0 },
    libraryLoanDays: { type: Number, default: 14, min: 1 },
  },
  { timestamps: true }
);
export const Settings = mongoose.model('Settings', settingsSchema);

export async function getSettings() {
  return (await Settings.findOne({ key: 'main' })) || Settings.create({ key: 'main' });
}
