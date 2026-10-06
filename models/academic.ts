import mongoose from 'mongoose';
import { registerModel } from './register';

const { Schema } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

export const Department = registerModel(
  'Department',
  new Schema(
    {
      name: { type: String, required: true, unique: true, trim: true },
      code: { type: String, required: true, unique: true, uppercase: true, trim: true },
      description: String,
      head: oid('Faculty'),
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
  )
);

export const Program = registerModel(
  'Program',
  (() => {
    const s = new Schema(
      {
        name: { type: String, required: true, trim: true },
        code: { type: String, required: true, unique: true, uppercase: true, trim: true },
        department: oid('Department', { required: true, index: true }),
        durationYears: { type: Number, min: 1, max: 8, default: 4 },
        totalSemesters: { type: Number, min: 1, max: 16, default: 8 },
        isActive: { type: Boolean, default: true },
      },
      { timestamps: true }
    );
    return s;
  })()
);

const academicYearSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isCurrent: { type: Boolean, default: false },
  },
  { timestamps: true }
);
export const AcademicYear = registerModel('AcademicYear', academicYearSchema);

const semesterSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    number: { type: Number, required: true, min: 1, max: 12 },
    academicYear: oid('AcademicYear', { required: true, index: true }),
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isCurrent: { type: Boolean, default: false },
  },
  { timestamps: true }
);
semesterSchema.index({ academicYear: 1, number: 1 }, { unique: true });
export const Semester = registerModel('Semester', semesterSchema);

const sectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    program: oid('Program', { required: true, index: true }),
    department: oid('Department', { required: true, index: true }),
    batch: { type: String, trim: true },
    semester: { type: Number, min: 1, max: 12, default: 1 },
    capacity: { type: Number, min: 1, default: 60 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
sectionSchema.index({ program: 1, batch: 1, semester: 1, name: 1 }, { unique: true });
export const Section = registerModel('Section', sectionSchema);

export const SUBJECT_TYPES = ['theory', 'practical', 'elective'];

const subjectSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    department: oid('Department', { required: true, index: true }),
    program: oid('Program', { required: true, index: true }),
    semester: { type: Number, required: true, min: 1, max: 12 },
    credits: { type: Number, required: true, min: 0, max: 30 },
    type: { type: String, enum: SUBJECT_TYPES, default: 'theory' },
    faculty: oid('Faculty', { index: true }),
    // Sections this subject is taught to. Empty = every section of program+semester.
    sections: [oid('Section')],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
subjectSchema.index({ program: 1, semester: 1 });
export const Subject = registerModel('Subject', subjectSchema);

const enrollmentSchema = new Schema(
  {
    student: oid('Student', { required: true }),
    subject: oid('Subject', { required: true }),
    semester: { type: Number, required: true },
    status: { type: String, enum: ['enrolled', 'dropped', 'completed'], default: 'enrolled' },
  },
  { timestamps: true }
);
enrollmentSchema.index({ student: 1, subject: 1 }, { unique: true });
enrollmentSchema.index({ subject: 1, status: 1 });
export const Enrollment = registerModel('Enrollment', enrollmentSchema);
