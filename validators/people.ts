// Zod schemas that check request data for students, faculty and user accounts before the services run.
import { z, objectId, optionalId, email, optionalPhone, optionalDate, phone, reqStr, str, password } from '@/validators/common';
import { STUDENT_STATUSES, ROLES } from '@/models/people';

const address = z
  .object({
    line1: str(150).optional(),
    line2: str(150).optional(),
    city: str(80).optional(),
    state: str(80).optional(),
    pincode: str(12).optional(),
    country: str(60).optional(),
  })
  .optional();

const guardian = z
  .object({
    name: str(100).optional(),
    relation: str(40).optional(),
    phone: optionalPhone,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .optional();

const emergency = z.object({ name: str(100).optional(), phone: optionalPhone, relation: str(40).optional() }).optional();

export const studentBase = z.object({
  studentId: reqStr(30),
  firstName: reqStr(60),
  lastName: reqStr(60),
  email,
  phone: optionalPhone,
  dateOfBirth: optionalDate,
  gender: z
    .enum(['male', 'female', 'other'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  address,
  guardian,
  emergencyContact: emergency,
  department: objectId,
  program: objectId,
  batch: str(20).optional(),
  academicYear: optionalId,
  semester: z.coerce.number().int().min(1).max(12).default(1),
  section: optionalId,
  admissionYear: z.coerce.number().int().min(1990).max(2100).optional(),
  admissionDate: optionalDate,
  status: z.enum(STUDENT_STATUSES as [string, ...string[]]).default('active'),
});

// A password is optional on create; the service makes one up when it is missing.
export const createStudentSchema = studentBase.extend({ password: password.optional() });

// On update a blank value means "clear this field": '' and null both become null (the service unsets it).
const clearable = (schema: any) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
const clearableObject = (shape: Record<string, any>) =>
  z.object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, clearable(v)]))).optional().nullable();
const addressShape = { line1: str(150), line2: str(150), city: str(80), state: str(80), pincode: str(12), country: str(60) };
const guardianShape = { name: str(100), relation: str(40), phone: phone, email: z.string().trim().toLowerCase().email() };
const emergencyShape = { name: str(100), phone: phone, relation: str(40) };

export const updateStudentSchema = studentBase.partial().extend({
  phone: clearable(phone),
  dateOfBirth: clearable(z.coerce.date()),
  gender: clearable(z.enum(['male', 'female', 'other'])),
  batch: clearable(str(20)),
  academicYear: clearable(objectId),
  section: clearable(objectId),
  admissionYear: clearable(z.coerce.number().int().min(1990).max(2100)),
  admissionDate: clearable(z.coerce.date()),
  address: clearableObject(addressShape),
  guardian: clearableObject(guardianShape),
  emergencyContact: clearableObject(emergencyShape),
});

/** Fields a student may edit on their own profile. */
export const selfStudentUpdateSchema = z.object({
  phone: optionalPhone,
  address,
  guardian,
  emergencyContact: emergency,
});

export const facultyBase = z.object({
  employeeId: reqStr(30),
  firstName: reqStr(60),
  lastName: reqStr(60),
  email,
  phone: optionalPhone,
  department: objectId,
  designation: str(80).optional(),
  status: z.enum(['active', 'inactive', 'on_leave']).default('active'),
  joiningDate: optionalDate,
});
export const createFacultySchema = facultyBase.extend({ password: password.optional() });
export const updateFacultySchema = facultyBase.partial().extend({
  phone: clearable(phone),
  designation: clearable(str(80)),
  joiningDate: clearable(z.coerce.date()),
});

export const createUserSchema = z.object({
  name: reqStr(120),
  email,
  role: z.enum(ROLES as [string, ...string[]]),
  password: password.optional(),
  children: z.array(objectId).optional(),
});
export const updateUserSchema = z.object({
  name: reqStr(120).optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  email: email.optional(),
  isActive: z.boolean().optional(),
  children: z.array(objectId).optional(),
});

// Approving a faculty sign-up creates their faculty profile, which needs an employee id and a department.
export const approveFacultySchema = z.object({
  employeeId: reqStr(40),
  department: objectId,
  designation: str(100).optional(),
});
