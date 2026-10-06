import request from './support/request';
import { setupDb, teardownDb, makeFixtures, login, auth, PASSWORD } from './helpers';
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
  test('admin creates a student with a login account and temporary password', async () => {
    const res = await request(app).post('/api/students').set(auth(fx.tokens.admin)).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.data.student.studentId).toBe('S900');
    const temp = res.body.data.temporaryPassword;
    expect(temp).toBeTruthy();
    const user = await User.findOne({ email: 'new.student@t.local' }).select('+password');
    expect(user.role).toBe('student');
    expect(user.mustChangePassword).toBe(true);
    expect(user.password).not.toBe(temp);
    expect((await login(app, 'new.student@t.local', temp)).user.email).toBe('new.student@t.local');
    // enrolled in the semester's subjects automatically
    const en = await request(app).get(`/api/students/${res.body.data.student._id}/enrollments`).set(auth(fx.tokens.admin));
    expect(en.body.data).toHaveLength(2);
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
    expect((await request(app).post('/api/auth/login').send({ email: 'new.student@t.local', password: PASSWORD })).status).toBe(401);
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
