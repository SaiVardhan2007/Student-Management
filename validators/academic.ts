import { z, objectId, optionalId, dateField, reqStr, str, bool } from '@/validators/common';
import { SUBJECT_TYPES } from '@/models/academic';



export const departmentSchema = z.object({
  name: reqStr(120),
  code: reqStr(12),
  description: str(500).optional(),
  head: optionalId,
  isActive: bool.optional(),
});

export const programSchema = z.object({
  name: reqStr(120),
  code: reqStr(20),
  department: objectId,
  durationYears: z.coerce.number().int().min(1).max(8).optional(),
  totalSemesters: z.coerce.number().int().min(1).max(16).optional(),
  isActive: bool.optional(),
});

const dateRange = (s) => s.refine((d) => d.endDate > d.startDate, { message: 'End date must be after start date', path: ['endDate'] });

export const academicYearSchema = dateRange(
  z.object({ name: reqStr(30), startDate: dateField, endDate: dateField, isCurrent: bool.optional() })
);

export const semesterSchema = dateRange(
  z.object({
    name: reqStr(60),
    number: z.coerce.number().int().min(1).max(12),
    academicYear: objectId,
    startDate: dateField,
    endDate: dateField,
    isCurrent: bool.optional(),
  })
);

export const sectionSchema = z.object({
  name: reqStr(30),
  program: objectId,
  department: objectId,
  batch: str(20).optional(),
  semester: z.coerce.number().int().min(1).max(12).optional(),
  capacity: z.coerce.number().int().min(1).max(500).optional(),
  isActive: bool.optional(),
});

export const subjectSchema = z.object({
  code: reqStr(20),
  name: reqStr(150),
  department: objectId,
  program: objectId,
  semester: z.coerce.number().int().min(1).max(12),
  credits: z.coerce.number().min(0).max(30),
  type: z.enum(SUBJECT_TYPES as [string, ...string[]]).default('theory'),
  faculty: optionalId,
  sections: z.array(objectId).optional(),
  isActive: bool.optional(),
});

export const enrollmentSchema = z.object({ student: objectId, subject: objectId });
