import { Exam, Timetable, Subject, Student, Enrollment } from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { requireValidId } from '@/lib/query';
import { facultyProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { crud } from '@/services/crud';
import { ownStudents } from '@/services/scope';
import { notifyStudents } from '@/services/notify';
import { audit } from '@/services/audit';

const overlaps = (aS: string, aE: string, bS: string, bE: string) => aS < bE && bS < aE;

// ---------------------------------------------------------------- exams
async function checkExamConflicts(body: Record<string, any>, current?: any) {
  const merged = { ...(current?.toObject?.() || {}), ...body };
  if (!merged.room) return;
  const day = new Date(merged.date);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const others = await Exam.find({
    date: { $gte: start, $lt: new Date(start.getTime() + 86400000) },
    room: merged.room,
    _id: { $ne: current?._id },
  }).lean();
  const clash = others.find((o: any) => overlaps(merged.startTime, merged.endTime, o.startTime, o.endTime));
  if (clash)
    throw AppError.conflict(`Room ${merged.room} is already booked for "${clash.name}" (${clash.startTime}-${clash.endTime}) on that date`);
}

/** Exams a user may see: admin everything; faculty published exams they teach/invigilate; students/parents their class. */
async function examScope(ctx: Ctx) {
  const { role } = ctx.user;
  if (role === 'admin') return {};
  if (role === 'faculty') {
    const f = await facultyProfile(ctx);
    const subjects = await Subject.find({ faculty: f._id }).select('_id').lean();
    return { isPublished: true, $or: [{ invigilators: f._id }, { subject: { $in: subjects.map((s: any) => s._id) } }] };
  }
  const students = await ownStudents(ctx);
  if (!students.length) return { _id: null };
  return { isPublished: true, $or: students.map((s: any) => ({ program: s.program, semester: s.semester })) };
}

async function announceExam(doc: any) {
  await notifyStudents(
    { program: doc.program, semester: doc.semester },
    {
      title: `Exam scheduled: ${doc.name}`,
      message: `${doc.date.toDateString()} ${doc.startTime}-${doc.endTime}${doc.room ? ` in ${doc.room}` : ''}`,
      type: 'exam',
      link: '/exams',
    }
  );
}

export const exams = crud({
  Model: Exam,
  entity: 'Exam',
  searchFields: ['name', 'room'],
  filterSpec: { subject: 'id', program: 'id', semester: 'number', type: 'string', isPublished: 'bool' },
  allowedSort: ['date', 'name'],
  defaultSort: { date: 1 },
  populate: [
    { path: 'subject', select: 'code name' },
    { path: 'program', select: 'name code' },
    { path: 'invigilators', select: 'firstName lastName' },
  ],
  scope: examScope,
  beforeCreate: async (ctx) => checkExamConflicts(ctx.body),
  beforeUpdate: async (ctx, doc) => {
    await checkExamConflicts(ctx.body, doc);
    ctx._wasPublished = doc.isPublished;
  },
  afterCreate: async (_ctx, doc) => doc.isPublished && announceExam(doc),
  afterUpdate: async (ctx, doc) => !ctx._wasPublished && doc.isPublished && announceExam(doc),
});

export async function generateSeating(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const exam = await Exam.findById(ctx.params.id);
  if (!exam) throw AppError.notFound('Exam not found');
  const enrolled = await Enrollment.find({ subject: exam.subject, status: 'enrolled' }).select('student').lean();
  const students = await Student.find({ _id: { $in: enrolled.map((e: any) => e.student) }, status: 'active' })
    .select('studentId')
    .sort({ studentId: 1 })
    .lean();
  if (students.length > ctx.body.perRoomCapacity)
    throw AppError.badRequest(`Room capacity (${ctx.body.perRoomCapacity}) is smaller than the number of students (${students.length})`);
  exam.seating = students.map((s: any, i: number) => ({ student: s._id, seat: `${ctx.body.prefix}-${String(i + 1).padStart(3, '0')}` }));
  await exam.save();
  await audit(ctx, 'EXAM_SEATING_GENERATED', 'Exam', exam._id, { seats: exam.seating.length });
  return ok({ seats: exam.seating.length }, 'Seating arrangement generated');
}

/** Seat for the logged-in student. */
export async function mySeat(ctx: Ctx) {
  const exam = await Exam.findOne({ _id: requireValidId(ctx.params.id), isPublished: true }).lean<any>();
  if (!exam) throw AppError.notFound('Exam not found');
  const [me] = await ownStudents(ctx);
  const seat = exam.seating?.find((s: any) => String(s.student) === String(me._id));
  return ok({ seat: seat?.seat || null, room: exam.room });
}

// ---------------------------------------------------------------- timetable
async function checkTimetableConflicts(body: Record<string, any>, current?: any) {
  const m = { ...(current?.toObject?.() || {}), ...body };
  const others = await Timetable.find({
    day: m.day,
    _id: { $ne: current?._id },
    $or: [{ faculty: m.faculty }, { room: m.room }, { section: m.section }],
  })
    .populate('subject', 'code')
    .lean();
  for (const o of others as any[]) {
    if (!overlaps(m.startTime, m.endTime, o.startTime, o.endTime)) continue;
    const what =
      String(o.faculty) === String(m.faculty) ? 'Faculty is' : String(o.section) === String(m.section) ? 'Section is' : 'Room is';
    throw AppError.conflict(`${what} already scheduled on ${m.day} ${o.startTime}-${o.endTime} (${o.subject?.code || 'another class'})`);
  }
}

export const timetable = crud({
  Model: Timetable,
  entity: 'Timetable',
  filterSpec: { section: 'id', faculty: 'id', day: 'string', subject: 'id', room: 'string' },
  allowedSort: ['day', 'startTime'],
  defaultSort: { startTime: 1 },
  populate: [
    { path: 'subject', select: 'code name' },
    { path: 'faculty', select: 'firstName lastName' },
    { path: 'section', select: 'name' },
  ],
  beforeCreate: async (ctx) => checkTimetableConflicts(ctx.body),
  beforeUpdate: async (ctx, doc) => checkTimetableConflicts(ctx.body, doc),
});

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export async function myTimetable(ctx: Ctx) {
  let filter: Record<string, any>;
  if (ctx.user.role === 'faculty') filter = { faculty: (await facultyProfile(ctx))._id };
  else {
    const students = await ownStudents(ctx);
    filter = { section: { $in: students.map((s: any) => s.section).filter(Boolean) } };
  }
  const slots = await Timetable.find(filter)
    .populate('subject', 'code name')
    .populate('faculty', 'firstName lastName')
    .populate('section', 'name')
    .lean<any[]>();
  slots.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.startTime.localeCompare(b.startTime));
  return ok(slots);
}
