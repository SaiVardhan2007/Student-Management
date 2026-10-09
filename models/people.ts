// MongoDB collections (Mongoose models) for people: users (logins), students and faculty.
import mongoose from 'mongoose';
import { registerModel } from './register';
import bcrypt from 'bcryptjs';
import { userCache } from '@/lib/doc-cache';

const { Schema } = mongoose;
// Shortcut for a field that stores the _id of a document in another collection.
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

export const ROLES = ['admin', 'faculty', 'student', 'parent'];
export const STUDENT_STATUSES = ['active', 'inactive', 'graduated', 'suspended', 'dropped'];

// A login account. Passwords are hashed, and the secret fields below are hidden from queries by default.
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    isActive: { type: Boolean, default: true },
    // Faculty who sign up themselves start as 'pending' (and inactive) until an admin approves or rejects them.
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: Date,
    // Only for parent accounts: the students linked to this parent.
    children: [oid('Student')],
    // Hashes of refresh tokens that are still valid (one per logged-in device).
    refreshTokens: {
      type: [{ tokenHash: String, expiresAt: Date, createdAt: { type: Date, default: Date.now } }],
      select: false,
      default: [],
    },
    // Forgot-password token (stored hashed) and when it stops working.
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    passwordChangedAt: Date,
    // Wrong-password counter; after too many attempts the account is locked until lockUntil.
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

// Hash the password before saving, but only when it was changed.
userSchema.pre('save', async function hash(this: any) {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
  this.passwordChangedAt = new Date();
});

userSchema.methods.comparePassword = function compare(this: any, plain: string) {
  return bcrypt.compare(plain, this.password);
};

// Never send secret fields to the browser when a user is returned as JSON.
userSchema.set('toJSON', {
  transform(_doc, ret: any) {
    delete ret.password;
    delete ret.refreshTokens;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpires;
    delete ret.passwordChangedAt;
    delete ret.failedLogins;
    delete ret.lockUntil;
    delete ret.__v;
    return ret;
  },
});

// A changed or deleted user must not be served from the login cache (lib/doc-cache.ts).
userSchema.post('save', (doc: any) => userCache.delete(String(doc._id)));
userSchema.post('deleteOne', { document: true, query: false }, (doc: any) => userCache.delete(String(doc._id)));
userSchema.post(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as any,
  () => userCache.clear()
);

export const User = registerModel('User', userSchema);

const addressSchema = new Schema(
  { line1: String, line2: String, city: String, state: String, pincode: String, country: String },
  { _id: false }
);

// A student's profile. It is separate from User, which only holds the login.
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
// fullName is calculated when read and is not stored in the database.
studentSchema.virtual('fullName').get(function fn(this: any) {
  return `${this.firstName} ${this.lastName}`;
});
studentSchema.set('toJSON', { virtuals: true });

export const Student = registerModel('Student', studentSchema);

// A teacher's profile. Like Student, it links to a User for login.
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
facultySchema.virtual('fullName').get(function fn(this: any) {
  return `${this.firstName} ${this.lastName}`;
});
facultySchema.set('toJSON', { virtuals: true });

export const Faculty = registerModel('Faculty', facultySchema);
