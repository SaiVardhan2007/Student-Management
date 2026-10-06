import request from './support/request';
import { setupDb, teardownDb, makeFixtures, auth, login } from './helpers';
import { Attendance, Mark, Notification, Settings } from '@/models';

let app: any;
let fx: any;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

const dateStr = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const rec = (i, status) => ({ student: String(fx.students[i]._id), status });

describe('attendance', () => {
  const body = (over = {}) => ({
    subject: String(fx.sub1._id),
    section: String(fx.section._id),
    date: dateStr(-1),
    records: [rec(0, 'present'), rec(1, 'absent'), rec(2, 'late')],
    ...over,
  });

  test('faculty sees their classes and roster', async () => {
    const classes = await request(app).get('/api/attendance/classes').set(auth(fx.tokens.fac1));
    expect(classes.body.data).toHaveLength(1);
    expect(classes.body.data[0].subject.code).toBe('CS101');
    const roster = await request(app)
      .get(`/api/attendance/roster?subject=${fx.sub1._id}&section=${fx.section._id}&date=${dateStr(-1)}`)
      .set(auth(fx.tokens.fac1));
    expect(roster.status).toBe(200);
    expect(roster.body.data.students.map((s) => s.studentId)).toEqual(['S1', 'S2', 'S3']); // S4 is in another section
  });

  test('faculty marks attendance; students cannot', async () => {
    expect((await request(app).post('/api/attendance').set(auth(fx.tokens.stu1)).send(body())).status).toBe(403);
    const res = await request(app).post('/api/attendance').set(auth(fx.tokens.fac1)).send(body());
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(3);
    expect(await Attendance.countDocuments({ subject: fx.sub1._id })).toBe(3);
  });

  test('prevents duplicates: re-saving updates in place and records who changed it', async () => {
    const res = await request(app)
      .post('/api/attendance')
      .set(auth(fx.tokens.fac1))
      .send(body({ records: [rec(1, 'present')] }));
    expect(res.body.data.saved).toBe(1);
    expect(await Attendance.countDocuments({ subject: fx.sub1._id, date: new Date(`${dateStr(-1)}T00:00:00Z`) })).toBe(3);
    const a = await Attendance.findOne({ student: fx.students[1]._id, subject: fx.sub1._id });
    expect(a.status).toBe('present');
    expect(String(a.modifiedBy)).toBeTruthy();
    expect(a.modifiedAt).toBeTruthy();
    // identical resubmission changes nothing
    const again = await request(app)
      .post('/api/attendance')
      .set(auth(fx.tokens.fac1))
      .send(body({ records: [rec(1, 'present')] }));
    expect(again.body.data.saved).toBe(0);
    // same student twice in one payload is rejected
    const dup = await request(app)
      .post('/api/attendance')
      .set(auth(fx.tokens.fac1))
      .send(body({ records: [rec(0, 'present'), rec(0, 'absent')] }));
    expect(dup.status).toBe(400);
  });

  test('rejects future dates, unassigned faculty, wrong-section students and bad statuses', async () => {
    expect(
      (
        await request(app)
          .post('/api/attendance')
          .set(auth(fx.tokens.fac1))
          .send(body({ date: dateStr(3) }))
      ).status
    ).toBe(400);
    expect((await request(app).post('/api/attendance').set(auth(fx.tokens.fac2)).send(body())).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/attendance')
          .set(auth(fx.tokens.fac1))
          .send(body({ records: [rec(3, 'present')] }))
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/attendance')
          .set(auth(fx.tokens.fac1))
          .send(body({ records: [rec(0, 'sleeping')] }))
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/attendance')
          .set(auth(fx.tokens.fac1))
          .send(body({ records: [] }))
      ).status
    ).toBe(400);
  });

  test('summary computes percentages and threshold warnings; students only see their own', async () => {
    // S3: late(1 day) + absent on day 2 => 50% < default 75%
    await request(app)
      .post('/api/attendance')
      .set(auth(fx.tokens.fac1))
      .send(body({ date: dateStr(-2), records: [rec(0, 'present'), rec(1, 'present'), rec(2, 'absent')] }));
    const mine = await request(app).get('/api/attendance/student/me/summary').set(auth(fx.tokens.stu1));
    expect(mine.body.data.overall.percentage).toBe(100);
    const s3 = await request(app).get(`/api/attendance/student/${fx.students[2]._id}/summary`).set(auth(fx.tokens.admin));
    expect(s3.body.data.overall.percentage).toBe(50);
    expect(s3.body.data.overall.belowThreshold).toBe(true);
    expect(s3.body.data.subjects[0].code).toBe('CS101');
    expect(s3.body.data.months.length).toBeGreaterThan(0);
    expect((await request(app).get(`/api/attendance/student/${fx.students[2]._id}/summary`).set(auth(fx.tokens.stu1))).status).toBe(403);
    // an in-app warning was generated for the student who fell below the threshold
    await new Promise((r) => setTimeout(r, 300));
    expect(await Notification.countDocuments({ user: fx.students[2].user, type: 'attendance' })).toBeGreaterThan(0);
  });

  test('threshold is configurable', async () => {
    await request(app).put('/api/settings').set(auth(fx.tokens.admin)).send({ attendanceThreshold: 40 });
    const s3 = await request(app).get(`/api/attendance/student/${fx.students[2]._id}/summary`).set(auth(fx.tokens.admin));
    expect(s3.body.data.overall.belowThreshold).toBe(false);
    await Settings.updateOne({ key: 'main' }, { attendanceThreshold: 75 });
  });

  test('correction request lifecycle', async () => {
    const att = await Attendance.findOne({ student: fx.students[2]._id, status: 'absent' });
    const send = (token, b) => request(app).post('/api/attendance/corrections').set(auth(token)).send(b);
    expect((await send(fx.tokens.stu2, { attendance: String(att._id), requestedStatus: 'present', reason: 'was in class' })).status).toBe(
      404
    ); // not their record
    const ok = await send((await login(app, 'stu3@t.local')).accessToken, {
      attendance: String(att._id),
      requestedStatus: 'excused',
      reason: 'Medical certificate submitted',
    });
    expect(ok.status).toBe(201);
    expect((await request(app).get('/api/attendance/corrections').set(auth(fx.tokens.fac2))).body.data).toHaveLength(0);
    const list = await request(app).get('/api/attendance/corrections?status=pending').set(auth(fx.tokens.fac1));
    expect(list.body.data).toHaveLength(1);
    expect(
      (await request(app).patch(`/api/attendance/corrections/${ok.body.data._id}`).set(auth(fx.tokens.fac2)).send({ status: 'approved' }))
        .status
    ).toBe(403);
    const rev = await request(app)
      .patch(`/api/attendance/corrections/${ok.body.data._id}`)
      .set(auth(fx.tokens.fac1))
      .send({ status: 'approved', reviewNote: 'ok' });
    expect(rev.status).toBe(200);
    expect((await Attendance.findById(att._id)).status).toBe('excused');
    expect(
      (await request(app).patch(`/api/attendance/corrections/${ok.body.data._id}`).set(auth(fx.tokens.fac1)).send({ status: 'rejected' }))
        .status
    ).toBe(409);
  });
});

describe('marks & results', () => {
  const enter = (token, over = {}) =>
    request(app)
      .post('/api/marks')
      .set(auth(token))
      .send({
        subject: String(fx.sub1._id),
        examType: 'mid',
        maxMarks: 50,
        records: [
          { student: String(fx.students[0]._id), marksObtained: 45 },
          { student: String(fx.students[1]._id), marksObtained: 20 },
        ],
        ...over,
      });

  test('only the assigned faculty (or admin) can enter marks', async () => {
    expect((await enter(fx.tokens.stu1)).status).toBe(403);
    expect((await enter(fx.tokens.fac2)).status).toBe(403);
    const ok = await enter(fx.tokens.fac1);
    expect(ok.status).toBe(200);
    expect(ok.body.data.saved).toBe(2);
    expect((await enter(fx.tokens.admin)).body.data.saved).toBe(0);
  });

  test('validates marks range and maximum', async () => {
    const over = await enter(fx.tokens.fac1, { records: [{ student: String(fx.students[0]._id), marksObtained: 51 }] });
    expect(over.status).toBe(400);
    expect((await enter(fx.tokens.fac1, { records: [{ student: String(fx.students[0]._id), marksObtained: -1 }] })).status).toBe(400);
    expect((await enter(fx.tokens.fac1, { examType: 'bonus' })).status).toBe(400);
    expect((await enter(fx.tokens.fac1, { maxMarks: 0 })).status).toBe(400);
  });

  test('updating a mark is tracked and never duplicates', async () => {
    const res = await enter(fx.tokens.fac1, { records: [{ student: String(fx.students[1]._id), marksObtained: 25 }] });
    expect(res.body.data.saved).toBe(1);
    expect(await Mark.countDocuments({ student: fx.students[1]._id, subject: fx.sub1._id })).toBe(1);
    expect(String((await Mark.findOne({ student: fx.students[1]._id })).updatedBy)).toBeTruthy();
  });

  test('results compute percentage, grade, SGPA and CGPA from the configured scale', async () => {
    await enter(fx.tokens.fac1, {
      examType: 'internal',
      maxMarks: 50,
      records: [{ student: String(fx.students[0]._id), marksObtained: 40 }],
    });
    const res = await request(app).get('/api/marks/student/me/results').set(auth(fx.tokens.stu1));
    expect(res.status).toBe(200);
    const s = res.body.data.subjects[0];
    expect(s.total).toBe(85);
    expect(s.percentage).toBe(85); // 85/100
    expect(s.grade).toBe('A+'); // default scale: >=80 => A+ (9 points)
    expect(res.body.data.semesters[0]).toMatchObject({ semester: 2, credits: 4, sgpa: 9 });
    expect(res.body.data.cgpa).toBe(9);
  });

  test('students cannot see other students results; parents can see their child', async () => {
    expect((await request(app).get(`/api/marks/student/${fx.students[1]._id}/results`).set(auth(fx.tokens.stu1))).status).toBe(403);
    expect((await request(app).get(`/api/marks/student/${fx.students[0]._id}/results`).set(auth(fx.tokens.parent))).status).toBe(200);
  });

  test('grading scale is admin-configurable and validated', async () => {
    const bad = await request(app)
      .put('/api/settings')
      .set(auth(fx.tokens.admin))
      .send({
        gradeScale: [
          { grade: 'P', minPercent: 50, points: 1 },
          { grade: 'F', minPercent: 10, points: 0 },
        ],
      });
    expect(bad.status).toBe(400);
    const good = await request(app)
      .put('/api/settings')
      .set(auth(fx.tokens.admin))
      .send({
        gradeScale: [
          { grade: 'Distinction', minPercent: 80, points: 10 },
          { grade: 'Pass', minPercent: 40, points: 6 },
          { grade: 'Fail', minPercent: 0, points: 0 },
        ],
      });
    expect(good.status).toBe(200);
    const res = await request(app).get('/api/marks/student/me/results').set(auth(fx.tokens.stu1));
    expect(res.body.data.subjects[0].grade).toBe('Distinction');
    expect((await request(app).put('/api/settings').set(auth(fx.tokens.fac1)).send({ collegeName: 'Nope' })).status).toBe(403);
  });

  test('class performance summary', async () => {
    const res = await request(app).get(`/api/marks/subject/${fx.sub1._id}/performance`).set(auth(fx.tokens.fac1));
    expect(res.status).toBe(200);
    expect(res.body.data.students).toBe(2);
    expect((await request(app).get(`/api/marks/subject/${fx.sub1._id}/performance`).set(auth(fx.tokens.fac2))).status).toBe(403);
  });
});
