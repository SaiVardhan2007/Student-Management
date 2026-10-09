import request from './support/request';
import { setupDb, teardownDb, makeFixtures, auth, PASSWORD } from './helpers';
import { User, Student, AuditLog } from '@/models';

let app: any;
let fx: any;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

const payload = (over = {}) => ({
  studentId: 'S900',
  firstName: 'New',
  lastName: 'Student',
  email: 'new.student@t.local',
  phone: '9876543210',
  department: String(fx.dept._id),
  program: String(fx.program._id),
  semester: 2,
  section: String(fx.section._id),
  ...over,
});

describe('role-based access control', () => {
  test('unauthenticated requests get 401', async () => {
    expect((await request(app).get('/api/students')).status).toBe(401);
  });

  test.each([
    ['get', '/api/users'],
    ['get', '/api/audit-logs'],
    ['get', '/api/students/export'],
    ['get', '/api/reports/students'],
    ['get', '/api/dashboard/admin'],
    ['post', '/api/import/students/preview'],
  ])('student cannot %s %s', async (method, url) => {
    const res = await request(app)[method](url).set(auth(fx.tokens.stu1));
    expect(res.status).toBe(403);
  });

  test('student and faculty cannot create students; faculty cannot create departments', async () => {
    expect((await request(app).post('/api/students').set(auth(fx.tokens.stu1)).send(payload())).status).toBe(403);
    expect((await request(app).post('/api/students').set(auth(fx.tokens.fac1)).send(payload())).status).toBe(403);
    expect((await request(app).post('/api/departments').set(auth(fx.tokens.fac1)).send({ name: 'X', code: 'X' })).status).toBe(403);
  });

  test('students cannot read another student, but can read themselves', async () => {
    const other = fx.students[2]._id;
    expect((await request(app).get(`/api/students/${other}`).set(auth(fx.tokens.stu1))).status).toBe(403);
    expect((await request(app).get(`/api/students/${fx.students[0]._id}`).set(auth(fx.tokens.stu1))).status).toBe(200);
    expect((await request(app).get('/api/students/me').set(auth(fx.tokens.stu1))).body.data.studentId).toBe('S1');
  });

  test('parent only sees linked children', async () => {
    const list = await request(app).get('/api/students').set(auth(fx.tokens.parent));
    expect(list.status).toBe(200);
    expect(list.body.data.map((s) => s.studentId)).toEqual(['S1']);
    expect((await request(app).get(`/api/students/${fx.students[1]._id}`).set(auth(fx.tokens.parent))).status).toBe(403);
    expect((await request(app).post('/api/students').set(auth(fx.tokens.parent)).send(payload())).status).toBe(403);
  });

  test('faculty only see students enrolled in their subjects', async () => {
    const res = await request(app).get('/api/students').set(auth(fx.tokens.fac1));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(4); // all four are enrolled in both subjects via program+semester
  });

  test('invalid ids and unknown routes are handled cleanly', async () => {
    expect((await request(app).get('/api/students/not-an-id').set(auth(fx.tokens.admin))).status).toBe(400);
    expect((await request(app).get('/api/nothing-here').set(auth(fx.tokens.admin))).status).toBe(404);
  });
});

describe('student management', () => {
  test('admin creates a student record; the student then signs up with email + admission number', async () => {
    const res = await request(app).post('/api/students').set(auth(fx.tokens.admin)).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.data.student.studentId).toBe('S900');
    expect(res.body.data.temporaryPassword).toBeUndefined();
    expect(await User.exists({ email: 'new.student@t.local' })).toBeNull();

    const reg = (over = {}) =>
      request(app)
        .post('/api/auth/register')
        .send({ accountType: 'student', admissionNumber: 's900', email: 'new.student@t.local', password: PASSWORD, ...over });
    // unknown admission number; an email that belongs to another student
    expect((await reg({ admissionNumber: 'NOPE1' })).status).toBe(400);
    expect((await reg({ email: 'stu1@t.local' })).status).toBe(409);
    // the student may sign up with an email of their own choice: it becomes the record's email too
    const ok = await reg({ email: 'my.own@t.local' });
    expect(ok.status).toBe(201);
    const user = await User.findOne({ email: 'my.own@t.local' });
    expect(user.role).toBe('student');
    const rec = await Student.findOne({ studentId: 'S900' });
    expect(String(rec.user)).toBe(String(user._id));
    expect(rec.email).toBe('my.own@t.local');
    // one account per admission number
    expect((await reg()).status).toBe(409);
    // the remaining tests use the original email
    await request(app).patch(`/api/students/${rec._id}`).set(auth(fx.tokens.admin)).send({ email: 'new.student@t.local' });
    // enrolled in the semester's subjects automatically
    const en = await request(app).get(`/api/students/${res.body.data.student._id}/enrollments`).set(auth(fx.tokens.admin));
    expect(en.body.data).toHaveLength(2);
  });

  test('student forgot-password needs the matching admission number; admin can fix the email', async () => {
    const forgot = (body) => request(app).post('/api/auth/forgot-password').send(body);
    const generic = (await forgot({ email: 'ghost@t.local' })).body.message;
    // wrong / missing admission number: same generic answer and no token is stored
    expect((await forgot({ email: 'new.student@t.local', admissionNumber: 'S111' })).body.message).toBe(generic);
    expect((await forgot({ email: 'new.student@t.local' })).body.message).toBe(generic);
    expect((await User.findOne({ email: 'new.student@t.local' }).select('+resetTokenHash')).resetTokenHash).toBeUndefined();
    expect((await forgot({ email: 'new.student@t.local', admissionNumber: 's900' })).status).toBe(200);
    expect((await User.findOne({ email: 'new.student@t.local' }).select('+resetTokenHash')).resetTokenHash).toBeTruthy();

    // admin changes the email on the student record; the login email follows
    const s = await Student.findOne({ studentId: 'S900' });
    const upd = await request(app).patch(`/api/students/${s._id}`).set(auth(fx.tokens.admin)).send({ email: 'fixed.student@t.local' });
    expect(upd.status).toBe(200);
    expect(await User.exists({ email: 'fixed.student@t.local' })).toBeTruthy();
    await request(app).patch(`/api/students/${s._id}`).set(auth(fx.tokens.admin)).send({ email: 'new.student@t.local' });
  });

  test('faculty sign-up waits for admin approval', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ accountType: 'faculty', name: 'Prof New', email: 'prof.new@t.local', password: PASSWORD });
    expect(reg.status).toBe(202);
    expect(reg.body.data.accessToken).toBeUndefined();
    const login1 = await request(app).post('/api/auth/login').send({ email: 'prof.new@t.local', password: PASSWORD });
    expect(login1.status).toBe(403);
    const u = await User.findOne({ email: 'prof.new@t.local' });
    expect(u.approvalStatus).toBe('pending');
    // only admins can approve
    const body = { employeeId: 'E900', department: String(fx.dept._id) };
    expect((await request(app).post(`/api/users/${u._id}/approve`).set(auth(fx.tokens.stu1)).send(body)).status).toBe(403);
    expect((await request(app).post(`/api/users/${u._id}/approve`).set(auth(fx.tokens.admin)).send(body)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'prof.new@t.local', password: PASSWORD })).status).toBe(200);
  });

  test('rejects duplicates (studentId case-insensitive and email)', async () => {
    const dupId = await request(app)
      .post('/api/students')
      .set(auth(fx.tokens.admin))
      .send(payload({ studentId: 's900', email: 'other@t.local' }));
    expect(dupId.status).toBe(409);
    const dupEmail = await request(app)
      .post('/api/students')
      .set(auth(fx.tokens.admin))
      .send(payload({ studentId: 'S901' }));
    expect(dupEmail.status).toBe(409);
    expect(await User.countDocuments({ email: 'other@t.local' })).toBe(0);
  });

  test('validates required fields, formats, enums and references', async () => {
    const res = await request(app).post('/api/students').set(auth(fx.tokens.admin)).send({
      studentId: '',
      firstName: 'A',
      email: 'bad',
      phone: 'abc',
      department: 'nope',
      program: fx.program._id,
      semester: 99,
      status: 'weird',
    });
    expect(res.status).toBe(400);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['studentId', 'lastName', 'email', 'phone', 'department', 'semester', 'status']));
    const missingRef = await request(app)
      .post('/api/students')
      .set(auth(fx.tokens.admin))
      .send(payload({ studentId: 'S902', email: 's902@t.local', department: '64b7f0f0f0f0f0f0f0f0f0f0' }));
    expect(missingRef.status).toBe(400);
  });

  test('list supports search, filter, sort and pagination', async () => {
    const page = await request(app).get('/api/students?limit=2&page=2&sort=studentId').set(auth(fx.tokens.admin));
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2, total: 5, pages: 3 });
    const search = await request(app).get('/api/students?search=S900').set(auth(fx.tokens.admin));
    expect(search.body.data).toHaveLength(1);
    const filter = await request(app).get(`/api/students?section=${fx.otherSection._id}`).set(auth(fx.tokens.admin));
    expect(filter.body.data.map((s) => s.studentId)).toEqual(['S4']);
    // regex characters in search are treated literally
    expect((await request(app).get('/api/students?search=.*').set(auth(fx.tokens.admin))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/students?limit=100000').set(auth(fx.tokens.admin))).body.meta.limit).toBe(100);
    expect((await request(app).get('/api/students?department=bad').set(auth(fx.tokens.admin))).status).toBe(400);
  });

  test('update changes fields and keeps the login account in sync', async () => {
    const s = await Student.findOne({ studentId: 'S900' });
    const res = await request(app)
      .patch(`/api/students/${s._id}`)
      .set(auth(fx.tokens.admin))
      .send({ firstName: 'Renamed', phone: '9123456780' });
    expect(res.status).toBe(200);
    expect((await User.findById(s.user)).name).toBe('Renamed Student');
  });

  test('students can edit only permitted profile fields', async () => {
    const res = await request(app)
      .patch('/api/students/me')
      .set(auth(fx.tokens.stu1))
      .send({ phone: '9000011111', status: 'graduated', studentId: 'HACK', semester: 8 });
    expect(res.status).toBe(200);
    const s = await Student.findById(fx.students[0]._id);
    expect(s.phone).toBe('9000011111');
    expect(s.status).toBe('active');
    expect(s.studentId).toBe('S1');
    expect(s.semester).toBe(2);
  });

  test('delete is a soft deactivation that disables login and is audited', async () => {
    const s = await Student.findOne({ studentId: 'S900' });
    const res = await request(app).delete(`/api/students/${s._id}`).set(auth(fx.tokens.admin));
    expect(res.status).toBe(200);
    expect((await Student.findById(s._id)).status).toBe('inactive');
    expect((await request(app).post('/api/auth/login').send({ email: 'new.student@t.local', password: PASSWORD })).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: 'STUDENT_DEACTIVATED', entityId: String(s._id) })).toBe(1);
    // reactivate
    expect((await request(app).post(`/api/students/${s._id}/activate`).set(auth(fx.tokens.admin))).status).toBe(200);
  });

  test('audit logs never contain passwords', async () => {
    const logs = JSON.stringify(await AuditLog.find().lean());
    expect(logs).not.toMatch(/Test@12345|temporaryPassword/);
    const res = await request(app).get('/api/audit-logs?limit=5').set(auth(fx.tokens.admin));
    expect(res.status).toBe(200);
  });
});
