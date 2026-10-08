import mongoose from 'mongoose';
import request from './support/request';
import { setupDb, teardownDb, makeFixtures, auth } from './helpers';
import * as M from '@/models';

let app: any;
let fx: any;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

const A = (t: string) => auth(t);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const id = (x: any) => String(x._id ?? x);

describe('faculty scope', () => {
  test('faculty only see attendance and results of their own subjects; dropped students leave their scope', async () => {
    const d = new Date(`${day(-3)}T00:00:00Z`);
    for (const subject of [fx.sub1, fx.sub2]) {
      await M.Attendance.create({ subject: subject._id, student: fx.students[0]._id, date: d, status: 'present', section: fx.section._id, markedBy: new mongoose.Types.ObjectId() });
      await M.Mark.create({ subject: subject._id, student: fx.students[0]._id, examType: 'mid', marksObtained: 40, maxMarks: 50, semester: 2, enteredBy: new mongoose.Types.ObjectId() });
    }
    const att = await request(app).get(`/api/attendance/student/${fx.students[0]._id}/summary`).set(A(fx.tokens.fac1));
    expect(att.status).toBe(200);
    expect(att.body.data.subjects.map((s: any) => s.code)).toEqual(['CS101']);
    const res = await request(app).get(`/api/marks/student/${fx.students[0]._id}/results`).set(A(fx.tokens.fac1));
    expect(res.body.data.subjects.map((s: any) => s.subject.code)).toEqual(['CS101']);
    const admin = await request(app).get(`/api/marks/student/${fx.students[0]._id}/results`).set(A(fx.tokens.admin));
    expect(admin.body.data.subjects).toHaveLength(2);

    await M.Enrollment.updateOne({ student: fx.students[3]._id, subject: fx.sub2._id }, { status: 'dropped' });
    const list = await request(app).get('/api/students').set(A(fx.tokens.fac2));
    expect(list.body.data.map((s: any) => s.studentId)).not.toContain('S4');
    expect((await request(app).get(`/api/students/${fx.students[3]._id}`).set(A(fx.tokens.fac2))).status).toBe(403);
    await M.Enrollment.updateOne({ student: fx.students[3]._id, subject: fx.sub2._id }, { status: 'enrolled' });
  });
});

describe('attendance writes', () => {
  const body = (records: any[]) => ({ subject: id(fx.sub1), section: id(fx.section), date: day(-1), records });

  test('warnings are sent once for a newly absent student, not on every save; remarks can be cleared', async () => {
    const stuUser = fx.students[0].user;
    const warnings = () => M.Notification.countDocuments({ user: stuUser, type: 'attendance' });
    const before = await warnings();
    const send = (records) => request(app).post('/api/attendance').set(A(fx.tokens.fac1)).send(body(records));
    const s0 = id(fx.students[0]);
    expect((await send([{ student: s0, status: 'absent', remarks: 'sick' }])).status).toBe(200);
    await wait(400);
    expect(await warnings()).toBe(before + 1);
    // saving the same absence again plus another student's change does not warn again
    await send([
      { student: s0, status: 'absent', remarks: 'sick' },
      { student: id(fx.students[1]), status: 'present' },
    ]);
    await wait(400);
    expect(await warnings()).toBe(before + 1);

    await send([{ student: s0, status: 'absent' }]); // remarks cleared
    const a = await M.Attendance.findOne({ student: fx.students[0]._id, subject: fx.sub1._id, date: new Date(`${day(-1)}T00:00:00Z`) });
    expect(a.remarks).toBeUndefined();
  });
});

describe('marks maximum', () => {
  test('rejects a different maximum when other students already have marks for that component', async () => {
    const send = (maxMarks, student) =>
      request(app)
        .post('/api/marks')
        .set(A(fx.tokens.fac1))
        .send({ subject: id(fx.sub1), examType: 'quiz', maxMarks, records: [{ student: id(fx.students[student]), marksObtained: 5 }] });
    expect((await send(10, 0)).status).toBe(200);
    expect((await send(20, 1)).status).toBe(400);
    expect((await send(10, 1)).status).toBe(200);
    // changing the maximum for everyone at once is allowed
    const both = await request(app)
      .post('/api/marks')
      .set(A(fx.tokens.fac1))
      .send({
        subject: id(fx.sub1),
        examType: 'quiz',
        maxMarks: 20,
        records: [0, 1].map((i) => ({ student: id(fx.students[i]), marksObtained: 5 })),
      });
    expect(both.status).toBe(200);
  });
});

describe('exams and timetable', () => {
  const exam = (over: any = {}) => ({
    name: 'Mid',
    subject: id(fx.sub1),
    program: id(fx.program),
    semester: 2,
    date: day(10),
    startTime: '09:00',
    endTime: '11:00',
    room: 'H1',
    ...over,
  });

  test('rejects inverted times on update and clashes by program/semester or invigilator', async () => {
    const created = await request(app).post('/api/exams').set(A(fx.tokens.admin)).send(exam({ invigilators: [id(fx.f1)] }));
    expect(created.status).toBe(201);
    const examId = created.body.data._id;
    expect((await request(app).patch(`/api/exams/${examId}`).set(A(fx.tokens.admin)).send({ endTime: '08:00' })).status).toBe(400);
    expect((await request(app).patch(`/api/exams/${examId}`).set(A(fx.tokens.admin)).send({ startTime: '12:00' })).status).toBe(400);
    // same program + semester, other room, overlapping
    expect(
      (await request(app).post('/api/exams').set(A(fx.tokens.admin)).send(exam({ subject: id(fx.sub2), room: 'H2', startTime: '10:00', endTime: '12:00' }))).status
    ).toBe(409);
    // other semester but same invigilator
    expect(
      (
        await request(app)
          .post('/api/exams')
          .set(A(fx.tokens.admin))
          .send(exam({ semester: 3, room: 'H3', startTime: '10:00', endTime: '12:00', invigilators: [id(fx.f1)] }))
      ).status
    ).toBe(409);
    // other semester, other room, no shared invigilator: fine
    expect((await request(app).post('/api/exams').set(A(fx.tokens.admin)).send(exam({ semester: 3, room: 'H3', startTime: '10:00', endTime: '12:00' }))).status).toBe(201);
  });

  test('seating works for any class size: capacity optional, extra rooms when needed', async () => {
    const e = await request(app).post('/api/exams').set(A(fx.tokens.admin)).send(exam({ date: day(20), room: undefined }));
    const none = await request(app).post(`/api/exams/${e.body.data._id}/seating`).set(A(fx.tokens.admin)).send({});
    expect(none.status).toBe(200);
    expect(none.body.data).toMatchObject({ seats: 4, halls: 1 });
    const split = await request(app).post(`/api/exams/${e.body.data._id}/seating`).set(A(fx.tokens.admin)).send({ perRoomCapacity: 3 });
    expect(split.body.data).toMatchObject({ seats: 4, halls: 2 });
    const doc = await M.Exam.findById(e.body.data._id);
    expect(doc.seating.map((s: any) => s.seat)).toEqual(['S1-001', 'S1-002', 'S1-003', 'S2-001']);
  });

  test('timetable: inverted update rejected; faculty and section must match the subject', async () => {
    const slot = { day: 'tuesday', startTime: '09:00', endTime: '10:00', subject: id(fx.sub1), faculty: id(fx.f1), room: 'R1', section: id(fx.section) };
    const ok = await request(app).post('/api/timetable').set(A(fx.tokens.admin)).send(slot);
    expect(ok.status).toBe(201);
    expect((await request(app).patch(`/api/timetable/${ok.body.data._id}`).set(A(fx.tokens.admin)).send({ endTime: '08:00' })).status).toBe(400);
    expect((await request(app).post('/api/timetable').set(A(fx.tokens.admin)).send({ ...slot, day: 'friday', faculty: id(fx.f2) })).status).toBe(400);
    const otherProgram = await M.Program.create({ name: 'Other', code: 'OTH', department: fx.dept._id });
    const foreign = await M.Section.create({ name: 'Z', program: otherProgram._id, department: fx.dept._id, batch: '2025', semester: 2 });
    expect((await request(app).post('/api/timetable').set(A(fx.tokens.admin)).send({ ...slot, day: 'friday', section: id(foreign) })).status).toBe(400);
  });
});

describe('enrollments', () => {
  const status = async (student, subject) => (await M.Enrollment.findOne({ student: student._id, subject: subject._id }))?.status;

  test('changing program/semester closes stale enrollments; cross-department program rejected on partial update', async () => {
    const s = fx.students[2];
    const dept2 = await M.Department.create({ name: 'Mech', code: 'MEC' });
    const prog2 = await M.Program.create({ name: 'B.Tech Mech', code: 'BTM', department: dept2._id });
    const bad = await request(app).patch(`/api/students/${s._id}`).set(A(fx.tokens.admin)).send({ program: id(prog2) });
    expect(bad.status).toBe(400);
    const prog3 = await M.Program.create({ name: 'MTech', code: 'MT', department: fx.dept._id });
    const res = await request(app).patch(`/api/students/${s._id}`).set(A(fx.tokens.admin)).send({ program: id(prog3), semester: 1 });
    expect(res.status).toBe(200);
    expect(await status(s, fx.sub1)).toBe('dropped');
    expect(await status(s, fx.sub2)).toBe('dropped');
    // moving up a semester in the same program completes the earlier semester
    const t = fx.students[1];
    await request(app).patch(`/api/students/${t._id}`).set(A(fx.tokens.admin)).send({ semester: 3 });
    expect(await status(t, fx.sub1)).toBe('completed');
  });

  test('updating a subject resyncs enrollments; manual enrollment is validated', async () => {
    const sub = await request(app)
      .post('/api/subjects')
      .set(A(fx.tokens.admin))
      .send({ code: 'CS201', name: 'Networks', department: id(fx.dept), program: id(fx.program), semester: 2, credits: 3, faculty: id(fx.f1) });
    expect(sub.status).toBe(201);
    const subject = { _id: sub.body.data._id };
    expect(await status(fx.students[3], subject)).toBe('enrolled');
    const upd = await request(app).patch(`/api/subjects/${subject._id}`).set(A(fx.tokens.admin)).send({ sections: [id(fx.section)] });
    expect(upd.status).toBe(200);
    expect(await status(fx.students[3], subject)).toBe('dropped'); // S4 is in the other section

    // manual enrollment of a core subject for a student who does not fit is refused; explicit re-enroll works when they fit
    const enroll = (student, subj) => request(app).post('/api/enrollments').set(A(fx.tokens.admin)).send({ student: id(student), subject: id(subj) });
    expect((await enroll(fx.students[3], subject)).status).toBe(400);
    const elective = await M.Subject.create({ code: 'EL1', name: 'Art', department: fx.dept._id, program: fx.program._id, semester: 5, credits: 2, type: 'elective', faculty: fx.f2._id });
    const first = await enroll(fx.students[3], elective);
    expect(first.status).toBe(201);
    await request(app).delete(`/api/enrollments/${first.body.data._id}`).set(A(fx.tokens.admin));
    const again = await enroll(fx.students[3], elective);
    expect(again.body.message).toMatch(/re-enrolled/);
    expect(await status(fx.students[3], elective)).toBe('enrolled');
  });
});

describe('student list sorting', () => {
  test('can sort by createdAt', async () => {
    const res = await request(app).get('/api/students?sort=-createdAt&limit=2&page=1').set(A(fx.tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});
