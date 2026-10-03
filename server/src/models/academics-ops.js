import mongoose from 'mongoose';

const { Schema } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

export const fileSchema = new Schema(
  { path: String, originalName: String, mimeType: String, size: Number },
  { _id: false }
);

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'];

const attendanceSchema = new Schema(
  {
    subject: oid('Subject', { required: true }),
    section: oid('Section', { required: true }),
    student: oid('Student', { required: true }),
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    remarks: { type: String, maxlength: 300 },
    markedBy: oid('User', { required: true }),
    modifiedBy: oid('User'),
    modifiedAt: Date,
  },
  { timestamps: true }
);
attendanceSchema.index({ subject: 1, student: 1, date: 1 }, { unique: true });
attendanceSchema.index({ student: 1, date: -1 });
attendanceSchema.index({ subject: 1, section: 1, date: 1 });
export const Attendance = mongoose.model('Attendance', attendanceSchema);

const correctionSchema = new Schema(
  {
    attendance: oid('Attendance', { required: true }),
    student: oid('Student', { required: true, index: true }),
    subject: oid('Subject', { required: true, index: true }),
    requestedStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: oid('User'),
    reviewedAt: Date,
    reviewNote: String,
  },
  { timestamps: true }
);
export const AttendanceCorrection = mongoose.model('AttendanceCorrection', correctionSchema);

export const MARK_TYPES = ['assignment', 'quiz', 'internal', 'practical', 'mid', 'final'];

const markSchema = new Schema(
  {
    student: oid('Student', { required: true }),
    subject: oid('Subject', { required: true }),
    semester: { type: Number, required: true },
    examType: { type: String, enum: MARK_TYPES, required: true },
    marksObtained: { type: Number, required: true, min: 0 },
    maxMarks: { type: Number, required: true, min: 1 },
    remarks: String,
    enteredBy: oid('User', { required: true }),
    updatedBy: oid('User'),
  },
  { timestamps: true }
);
markSchema.index({ student: 1, subject: 1, examType: 1 }, { unique: true });
markSchema.index({ subject: 1, examType: 1 });
markSchema.index({ student: 1, semester: 1 });
export const Mark = mongoose.model('Mark', markSchema);

const examSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['internal', 'mid', 'final', 'practical'], default: 'mid' },
    subject: oid('Subject', { required: true, index: true }),
    program: oid('Program', { required: true, index: true }),
    semester: { type: Number, required: true },
    date: { type: Date, required: true, index: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    room: String,
    invigilators: [oid('Faculty')],
    maxMarks: { type: Number, default: 100, min: 1 },
    isPublished: { type: Boolean, default: false, index: true },
    seating: [{ student: oid('Student'), seat: String, _id: false }],
  },
  { timestamps: true }
);
export const Exam = mongoose.model('Exam', examSchema);

const assignmentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 5000 },
    subject: oid('Subject', { required: true, index: true }),
    sections: [oid('Section')],
    deadline: { type: Date, required: true, index: true },
    maxMarks: { type: Number, required: true, min: 1 },
    attachment: fileSchema,
    createdBy: oid('User', { required: true }),
    reminderSentAt: Date,
  },
  { timestamps: true }
);
export const Assignment = mongoose.model('Assignment', assignmentSchema);

const submissionSchema = new Schema(
  {
    assignment: oid('Assignment', { required: true }),
    student: oid('Student', { required: true }),
    text: { type: String, maxlength: 5000 },
    files: [fileSchema],
    submittedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['submitted', 'late', 'evaluated'], default: 'submitted' },
    marks: { type: Number, min: 0 },
    feedback: String,
    evaluatedBy: oid('User'),
    evaluatedAt: Date,
  },
  { timestamps: true }
);
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
submissionSchema.index({ student: 1, submittedAt: -1 });
export const Submission = mongoose.model('Submission', submissionSchema);

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const timetableSchema = new Schema(
  {
    day: { type: String, enum: DAYS, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    subject: oid('Subject', { required: true }),
    faculty: oid('Faculty', { required: true, index: true }),
    room: { type: String, required: true, trim: true },
    section: oid('Section', { required: true, index: true }),
  },
  { timestamps: true }
);
timetableSchema.index({ day: 1, room: 1 });
export const Timetable = mongoose.model('Timetable', timetableSchema);
