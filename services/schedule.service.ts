// Exams (with seating) and the weekly timetable, including room/faculty clash checks.
import { Exam, Timetable, Subject, Section, Student, Enrollment } from '@/models';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/response';
import { requireValidId } from '@/lib/query';
import { facultyProfile } from '@/lib/auth';
import type { Ctx } from '@/lib/context';
import { crud } from '@/services/crud';
import { ownStudents } from '@/services/scope';
import { notifyStudents } from '@/services/notify';
import { audit } from '@/services/audit';

/** Do two time ranges overlap? Times are 'HH:mm' strings, so string comparison works. */
const overlaps = (aS: string, aE: string, bS: string, bE: string) => aS < bE && bS < aE;

// ---------------------------------------------------------------- exams
// The create schema checks end > start, but partial update schemas skip that rule, so re-check on the merged values.
function assertTimeOrder(m: Record<string, any>) {
  if (m.startTime && m.endTime && m.endTime <= m.startTime)
    throw AppError.badRequest('End time must be after start time', [{ field: 'endTime', message: 'End time must be after start time' }]);
}

/** Throw if another exam at an overlapping time on the same day shares the room, the program + semester or an invigilator. */
async function checkExamConflicts(body: Record<string, any>, current?: any) {
  // when editing, combine the saved exam with the changed fields
  const merged = { ...(current?.toObject?.() || {}), ...body };
  assertTimeOrder(merged);
  const day = new Date(merged.date);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const invigilators = (merged.invigilators || []).map(String);
  const sharing: Record<string, any>[] = [{ program: merged.program, semester: merged.semester }];
  if (merged.room) sharing.push({ room: merged.room });
  if (invigilators.length) sharing.push({ invigilators: { $in: invigilators } });
  const others = await Exam.find({
    date: { $gte: start, $lt: new Date(start.getTime() + 86400000) },
    _id: { $ne: current?._id },
    $or: sharing,
  }).lean<any[]>();
  for (const o of others) {
    if (!overlaps(merged.startTime, merged.endTime, o.startTime, o.endTime)) continue;
    const when = `"${o.name}" (${o.startTime}-${o.endTime}) on that date`;
    if (merged.room && o.room === merged.room) throw AppError.conflict(`Room ${merged.room} is already booked for ${when}`);
    if (String(o.program) === String(merged.program) && o.semester === merged.semester)
      throw AppError.conflict(`Students of this program and semester already have ${when}`);
    throw AppError.conflict(`An invigilator is already assigned to ${when}`);
  }
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

/** Give every active student enrolled in the exam's subject a seat number like A-001 (in student id order). */
export async function generateSeating(ctx: Ctx) {
  requireValidId(ctx.params.id);
  const exam = await Exam.findById(ctx.params.id);
  if (!exam) throw AppError.notFound('Exam not found');
  const enrolled = await Enrollment.find({ subject: exam.subject, status: 'enrolled' }).select('student').lean();
  const students = await Student.find({ _id: { $in: enrolled.map((e: any) => e.student) }, status: 'active' })
    .select('studentId')
    .sort({ studentId: 1 })
    .lean();
  // no capacity given = one hall without a limit; a capacity smaller than the class spills over into extra halls (S1-001, S2-001, ...)
  const capacity: number = ctx.body.perRoomCapacity || students.length || 1;
  const halls = Math.max(Math.ceil(students.length / capacity), 1);
  const pad = (n: number) => String(n).padStart(3, '0');
  exam.seating = students.map((s: any, i: number) => ({
    student: s._id,
    seat: halls > 1 ? `${ctx.body.prefix}${Math.floor(i / capacity) + 1}-${pad((i % capacity) + 1)}` : `${ctx.body.prefix}-${pad(i + 1)}`,
  }));
  await exam.save();
  await audit(ctx, 'EXAM_SEATING_GENERATED', 'Exam', exam._id, { seats: exam.seating.length, halls });
  return ok({ seats: exam.seating.length, halls }, 'Seating arrangement generated');
}

/** The logged-in student's seat number for an exam. */
export async function mySeat(ctx: Ctx) {
  const exam = await Exam.findOne({ _id: requireValidId(ctx.params.id), isPublished: true }).lean<any>();
  if (!exam) throw AppError.notFound('Exam not found');
  const [me] = await ownStudents(ctx);
  const seat = exam.seating?.find((s: any) => String(s.student) === String(me._id));
  return ok({ seat: seat?.seat || null, room: exam.room });
}

// ---------------------------------------------------------------- timetable
/** The slot's faculty must teach the subject and its section must study it. */
async function checkSubjectMatch(m: Record<string, any>) {
  const [subject, section] = await Promise.all([Subject.findById(m.subject).lean<any>(), Section.findById(m.section).lean<any>()]);
  if (!subject) throw AppError.badRequest('Subject not found');
  if (!section) throw AppError.badRequest('Section not found');
  if (subject.faculty && String(subject.faculty) !== String(m.faculty))
    throw AppError.badRequest('Faculty is not assigned to this subject');
  const sectionOk = subject.sections?.length
    ? subject.sections.some((id: any) => String(id) === String(section._id))
    : String(section.program) === String(subject.program) && section.semester === subject.semester;
  if (!sectionOk) throw AppError.badRequest('This section does not study the selected subject');
}

/** Throw if the faculty, room or section is already busy in an overlapping slot on the same day. */
async function checkTimetableConflicts(body: Record<string, any>, current?: any) {
  const m = { ...(current?.toObject?.() || {}), ...body };
  assertTimeOrder(m);
  await checkSubjectMatch(m);
  const others = await Timetable.find({
    day: m.day,
    _id: { $ne: current?._id },
    $or: [{ faculty: m.faculty }, { room: m.room }, { section: m.section }],
  })
    .populate('subject', 'code')
    .lean();
  for (const o of others as any[]) {
    if (!overlaps(m.startTime, m.endTime, o.startTime, o.endTime)) continue;
    let what = 'Room is';
    if (String(o.faculty) === String(m.faculty)) what = 'Faculty is';
    else if (String(o.section) === String(m.section)) what = 'Section is';
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

/** Timetable for the logged-in user, sorted by day of the week and then start time. */
export async function myTimetable(ctx: Ctx) {
  // faculty see their own classes; students/parents see the classes of their sections
  let filter: Record<string, any>;
  if (ctx.user.role === 'faculty') {
    filter = { faculty: (await facultyProfile(ctx))._id };
  } else {
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
