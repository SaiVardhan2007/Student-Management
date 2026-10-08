// MongoDB collections (Mongoose models) for the academic structure: departments, programs, years, semesters,
// sections, subjects and enrollments.
import mongoose from 'mongoose';
import { registerModel } from './register';

const { Schema } = mongoose;
// Shortcut for a field that stores the _id of a document in another collection.
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

// One row per department.
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

// One row per degree program (for example B.Tech) inside a department.
const programSchema = new Schema(
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
export const Program = registerModel('Program', programSchema);

// One row per academic year, e.g. 2025-26.
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

// One row per semester of an academic year.
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

// A class group (like 'A') of a program, batch and semester.
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

// One row per subject (course) taught in a program and semester.
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
    // Sections that study this subject. Empty means every section of that program and semester.
    sections: [oid('Section')],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
subjectSchema.index({ program: 1, semester: 1 });
export const Subject = registerModel('Subject', subjectSchema);

// One row per student per subject they study.
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
