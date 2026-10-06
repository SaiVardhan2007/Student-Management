import { z, objectId, optionalId, dateField, optionalDate, time, reqStr, str, bool } from '@/validators/common';
import { DAYS } from '@/models/academics-ops';
import { MATERIAL_TYPES, NOTICE_AUDIENCES } from '@/models/campus';


const timeOrder = (s) => s.refine((d) => d.endTime > d.startTime, { message: 'End time must be after start time', path: ['endTime'] });

export const examSchema = timeOrder(
  z.object({
    name: reqStr(150),
    type: z.enum(['internal', 'mid', 'final', 'practical']).default('mid'),
    subject: objectId,
    program: objectId,
    semester: z.coerce.number().int().min(1).max(12),
    date: dateField,
    startTime: time,
    endTime: time,
    room: str(60).optional(),
    invigilators: z.array(objectId).optional(),
    maxMarks: z.coerce.number().positive().max(1000).default(100),
    isPublished: bool.optional(),
  })
);

export const timetableSchema = timeOrder(
  z.object({ day: z.enum(DAYS as [string, ...string[]]), startTime: time, endTime: time, subject: objectId, faculty: objectId, room: reqStr(60), section: objectId })
);

export const assignmentSchema = z.object({
  title: reqStr(200),
  description: str(5000).optional(),
  subject: objectId,
  sections: z.union([z.array(objectId), objectId.transform((v) => [v])]).optional(),
  deadline: dateField,
  maxMarks: z.coerce.number().positive().max(1000),
});
export const assignmentUpdateSchema = assignmentSchema.partial();

export const submitSchema = z.object({ text: str(5000).optional() });
export const evaluateSchema = z.object({ marks: z.coerce.number().min(0), feedback: str(2000).optional() });

export const noticeSchema = z.object({
  title: reqStr(200),
  description: reqStr(5000),
  audience: z.enum(NOTICE_AUDIENCES as [string, ...string[]]).default('all'),
  department: optionalId,
  program: optionalId,
  year: z.coerce
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  section: optionalId,
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  publishDate: optionalDate,
  expiryDate: optionalDate,
});
export const noticeUpdateSchema = noticeSchema.partial();

export const materialSchema = z.object({
  title: reqStr(200),
  description: str(1000).optional(),
  subject: objectId,
  type: z.enum(MATERIAL_TYPES as [string, ...string[]]).default('notes'),
});

export const calendarSchema = z
  .object({
    title: reqStr(200),
    description: str(1000).optional(),
    type: z.enum(['exam', 'holiday', 'assignment', 'seminar', 'event', 'deadline']).default('event'),
    startDate: dateField,
    endDate: optionalDate,
    audience: z.enum(NOTICE_AUDIENCES as [string, ...string[]]).default('all'),
  })
  .refine((d) => !d.endDate || d.endDate >= d.startDate, { message: 'End date cannot be before start date', path: ['endDate'] });
