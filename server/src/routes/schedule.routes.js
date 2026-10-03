import { Router } from 'express';
import { protect, authorize, facultyProfile } from '../middleware/auth.js';
import { validate, z } from '../middleware/validate.js';
import { crud } from '../controllers/crud.js';
import { asyncHandler, ok, requireValidId } from '../utils/http.js';
import { AppError } from '../utils/AppError.js';
import { Exam, Timetable, Subject, Student, Enrollment } from '../models/index.js';
import { examSchema, timetableSchema } from '../validators/ops.js';
import { ownStudents } from '../services/scope.js';
import { notifyStudents } from '../services/notify.js';
import { audit } from '../services/audit.js';

const admin = authorize('admin');
const router = Router();
router.use(protect);

// ---------------------------------------------------------------- exams
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;

async function checkExamConflicts(body, current) {
  const merged = { ...(current?.toObject?.() || {}), ...body };
  if (!merged.room) return;
  const day = new Date(merged.date);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const others = await Exam.find({ date: { $gte: start, $lt: new Date(start.getTime() + 86400000) }, room: merged.room, _id: { $ne: current?._id } }).lean();
  const clash = others.find((o) => overlaps(merged.startTime, merged.endTime, o.startTime, o.endTime));
  if (clash) throw AppError.conflict(`Room ${merged.room} is already booked for "${clash.name}" (${clash.startTime}-${clash.endTime}) on that date`);
}

async function examScope(req) {
  const { role } = req.user;
  if (role === 'admin') return {};
  if (role === 'faculty') {
    const f = await facultyProfile(req);
    const subjects = await Subject.find({ faculty: f._id }).select('_id').lean();
    return { isPublished: true, $or: [{ invigilators: f._id }, { subject: { $in: subjects.map((s) => s._id) } }] };
  }
  const students = await ownStudents(req);
  if (!students.length) return { _id: null };
  return { isPublished: true, $or: students.map((s) => ({ program: s.program, semester: s.semester })) };
}

const exams = crud({
  Model: Exam,
  entity: 'Exam',
  searchFields: ['name', 'room'],
  filterSpec: { subject: 'id', program: 'id', semester: 'number', type: 'string', isPublished: 'bool' },
  allowedSort: ['date', 'name'],
  defaultSort: { date: 1 },
  populate: [{ path: 'subject', select: 'code name' }, { path: 'program', select: 'name code' }, { path: 'invigilators', select: 'firstName lastName' }],
  scope: examScope,
  beforeCreate: async (req) => checkExamConflicts(req.body),
  beforeUpdate: async (req, doc) => {
    await checkExamConflicts(req.body, doc);
    req._wasPublished = doc.isPublished;
  },
  afterCreate: async (_req, doc) => doc.isPublished && announceExam(doc),
  afterUpdate: async (req, doc) => !req._wasPublished && doc.isPublished && announceExam(doc),
});

async function announceExam(doc) {
  await notifyStudents({ program: doc.program, semester: doc.semester }, { title: `Exam scheduled: ${doc.name}`, message: `${doc.date.toDateString()} ${doc.startTime}-${doc.endTime}${doc.room ? ` in ${doc.room}` : ''}`, type: 'exam', link: '/exams' });
}

const exR = Router();
exR.get('/', exams.list);
exR.get('/:id', exams.get);
exR.post('/', admin, validate(examSchema), exams.create);
exR.put('/:id', admin, validate(examSchema._def.schema.partial()), exams.update);
exR.patch('/:id', admin, validate(examSchema._def.schema.partial()), exams.update);
exR.delete('/:id', admin, exams.remove);
exR.post('/:id/seating', admin, validate(z.object({ perRoomCapacity: z.coerce.number().int().min(1).max(1000).default(60), prefix: z.string().trim().max(5).default('S') })), asyncHandler(async (req, res) => {
  requireValidId(req.params.id);
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw AppError.notFound('Exam not found');
  const enrolled = await Enrollment.find({ subject: exam.subject, status: 'enrolled' }).select('student').lean();
  const students = await Student.find({ _id: { $in: enrolled.map((e) => e.student) }, status: 'active' }).select('studentId').sort({ studentId: 1 }).lean();
  if (students.length > req.body.perRoomCapacity) throw AppError.badRequest(`Room capacity (${req.body.perRoomCapacity}) is smaller than the number of students (${students.length})`);
  exam.seating = students.map((s, i) => ({ student: s._id, seat: `${req.body.prefix}-${String(i + 1).padStart(3, '0')}` }));
  await exam.save();
  await audit(req, 'EXAM_SEATING_GENERATED', 'Exam', exam._id, { seats: exam.seating.length });
  ok(res, { seats: exam.seating.length }, 'Seating arrangement generated');
}));
/** Seat for the logged-in student. */
exR.get('/:id/my-seat', authorize('student'), asyncHandler(async (req, res) => {
  const exam = await Exam.findOne({ _id: requireValidId(req.params.id), isPublished: true }).lean();
  if (!exam) throw AppError.notFound('Exam not found');
  const [me] = await ownStudents(req);
  const seat = exam.seating?.find((s) => String(s.student) === String(me._id));
  ok(res, { seat: seat?.seat || null, room: exam.room });
}));
router.use('/exams', exR);

// ---------------------------------------------------------------- timetable
async function checkTimetableConflicts(body, current) {
  const m = { ...(current?.toObject?.() || {}), ...body };
  const others = await Timetable.find({ day: m.day, _id: { $ne: current?._id }, $or: [{ faculty: m.faculty }, { room: m.room }, { section: m.section }] })
    .populate('subject', 'code')
    .lean();
  for (const o of others) {
    if (!overlaps(m.startTime, m.endTime, o.startTime, o.endTime)) continue;
    const what = String(o.faculty) === String(m.faculty) ? 'Faculty is' : String(o.section) === String(m.section) ? 'Section is' : 'Room is';
    throw AppError.conflict(`${what} already scheduled on ${m.day} ${o.startTime}-${o.endTime} (${o.subject?.code || 'another class'})`);
  }
}

const tt = crud({
  Model: Timetable,
  entity: 'Timetable',
  filterSpec: { section: 'id', faculty: 'id', day: 'string', subject: 'id', room: 'string' },
  allowedSort: ['day', 'startTime'],
  defaultSort: { startTime: 1 },
  populate: [{ path: 'subject', select: 'code name' }, { path: 'faculty', select: 'firstName lastName' }, { path: 'section', select: 'name' }],
  beforeCreate: async (req) => checkTimetableConflicts(req.body),
  beforeUpdate: async (req, doc) => checkTimetableConflicts(req.body, doc),
});

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const ttR = Router();
ttR.get('/me', authorize('student', 'faculty', 'parent'), asyncHandler(async (req, res) => {
  let filter;
  if (req.user.role === 'faculty') filter = { faculty: (await facultyProfile(req))._id };
  else {
    const students = await ownStudents(req);
    filter = { section: { $in: students.map((s) => s.section).filter(Boolean) } };
  }
  const slots = await Timetable.find(filter).populate('subject', 'code name').populate('faculty', 'firstName lastName').populate('section', 'name').lean();
  slots.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.startTime.localeCompare(b.startTime));
  ok(res, slots);
}));
ttR.get('/', authorize('admin', 'faculty'), tt.list);
ttR.get('/:id', authorize('admin', 'faculty'), tt.get);
ttR.post('/', admin, validate(timetableSchema), tt.create);
ttR.put('/:id', admin, validate(timetableSchema._def.schema.partial()), tt.update);
ttR.patch('/:id', admin, validate(timetableSchema._def.schema.partial()), tt.update);
ttR.delete('/:id', admin, tt.remove);
router.use('/timetable', ttR);

export default router;
