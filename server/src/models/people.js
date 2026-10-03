import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

export const ROLES = ['admin', 'faculty', 'student', 'parent'];
export const STUDENT_STATUSES = ['active', 'inactive', 'graduated', 'suspended', 'dropped'];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: Date,
    // parent accounts: linked children
    children: [oid('Student')],
    refreshTokens: {
      type: [{ tokenHash: String, expiresAt: Date, createdAt: { type: Date, default: Date.now } }],
      select: false,
      default: [],
    },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    passwordChangedAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function hash(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  this.passwordChangedAt = new Date();
  next();
});

userSchema.methods.comparePassword = function compare(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.refreshTokens;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpires;
    delete ret.passwordChangedAt;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

const addressSchema = new Schema(
  { line1: String, line2: String, city: String, state: String, pincode: String, country: String },
  { _id: false }
);

const studentSchema = new Schema(
  {
    user: oid('User', { index: true }),
    studentId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other'] },
    photo: String,
    address: addressSchema,
    guardian: { name: String, relation: String, phone: String, email: String },
    emergencyContact: { name: String, phone: String, relation: String },
    department: oid('Department', { required: true, index: true }),
    program: oid('Program', { required: true, index: true }),
    batch: { type: String, trim: true },
    academicYear: oid('AcademicYear'),
    semester: { type: Number, min: 1, max: 12, default: 1 },
    section: oid('Section', { index: true }),
    admissionYear: { type: Number, min: 1990, max: 2100 },
    admissionDate: Date,
    status: { type: String, enum: STUDENT_STATUSES, default: 'active', index: true },
  },
  { timestamps: true }
);
studentSchema.index({ firstName: 1, lastName: 1 });
studentSchema.index({ department: 1, program: 1, semester: 1, section: 1 });
studentSchema.virtual('fullName').get(function fn() {
  return `${this.firstName} ${this.lastName}`;
});
studentSchema.set('toJSON', { virtuals: true });

export const Student = mongoose.model('Student', studentSchema);

const facultySchema = new Schema(
  {
    user: oid('User', { index: true }),
    employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    department: oid('Department', { required: true, index: true }),
    designation: { type: String, trim: true },
    status: { type: String, enum: ['active', 'inactive', 'on_leave'], default: 'active', index: true },
    joiningDate: Date,
    photo: String,
  },
  { timestamps: true }
);
facultySchema.virtual('fullName').get(function fn() {
  return `${this.firstName} ${this.lastName}`;
});
facultySchema.set('toJSON', { virtuals: true });

export const Faculty = mongoose.model('Faculty', facultySchema);
