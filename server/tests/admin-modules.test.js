import request from 'supertest';
import { setupDb, teardownDb, makeFixtures, auth, login, PASSWORD } from './helpers.js';
import { User, Faculty, Subject, AuditLog } from '../src/models/index.js';

let app;
let fx;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

const as = (role) => auth(fx.tokens[role]);

describe('user administration', () => {
  test('only admins can list users, and search/filter works', async () => {
    expect((await request(app).get('/api/users').set(as('fac1'))).status).toBe(403);
    expect((await request(app).get('/api/users').set(as('stu1'))).status).toBe(403);
    const res = await request(app).get('/api/users?role=faculty&search=fac').set(as('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((u) => u.role === 'faculty')).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  test('creates a parent linked to a child with a one-time temporary password', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(as('admin'))
      .send({ name: 'New Parent', email: 'newparent@t.local', role: 'parent', children: [String(fx.students[1]._id)] });
    expect(res.status).toBe(201);
    expect(res.body.data.temporaryPassword).toBeTruthy();
    const u = await User.findOne({ email: 'newparent@t.local' });
    expect(u.mustChangePassword).toBe(true);
    expect(String(u.children[0])).toBe(String(fx.students[1]._id));
    const first = await login(app, 'newparent@t.local', res.body.data.temporaryPassword);
    expect(first.user.mustChangePassword).toBe(true);
  });

  test('refuses to create student/faculty here, unknown children and duplicate emails', async () => {
    const asStudent = await request(app).post('/api/users').set(as('admin')).send({ name: 'X Y', email: 'x@t.local', role: 'student' });
    expect(asStudent.status).toBe(400);
    const badChild = await request(app)
      .post('/api/users')
      .set(as('admin'))
      .send({ name: 'P Q', email: 'pq@t.local', role: 'parent', children: ['64b64b64b64b64b64b64b64b'] });
    expect(badChild.status).toBe(400);
    const dup = await request(app).post('/api/users').set(as('admin')).send({ name: 'Dup', email: 'admin@t.local', role: 'admin' });
    expect([400, 409]).toContain(dup.status);
  });

  test('gets one user, 404s on unknown ids and 400s on malformed ids', async () => {
    const parent = await User.findOne({ email: 'parent@t.local' });
    const ok = await request(app).get(`/api/users/${parent._id}`).set(as('admin'));
    expect(ok.status).toBe(200);
    expect(ok.body.data.children.length).toBe(1);
    expect((await request(app).get('/api/users/64b64b64b64b64b64b64b64b').set(as('admin'))).status).toBe(404);
    expect((await request(app).get('/api/users/not-an-id').set(as('admin'))).status).toBe(400);
  });

  test('admins cannot deactivate or demote themselves; role changes to/from student are blocked', async () => {
    const admin = await User.findOne({ email: 'admin@t.local' });
    const self = await request(app).patch(`/api/users/${admin._id}`).set(as('admin')).send({ isActive: false });
    expect(self.status).toBe(400);
    const demote = await request(app).patch(`/api/users/${admin._id}`).set(as('admin')).send({ role: 'parent' });
    expect(demote.status).toBe(400);
    const stu = await User.findOne({ email: 'stu1@t.local' });
    const toAdmin = await request(app).patch(`/api/users/${stu._id}`).set(as('admin')).send({ role: 'admin' });
    expect(toAdmin.status).toBe(400);
  });

  test('deactivating a user revokes sessions and blocks login; reactivating restores it', async () => {
    const victim = await User.findOne({ email: 'stu2@t.local' });
    const sessions = await login(app, 'stu2@t.local');
    const off = await request(app).patch(`/api/users/${victim._id}`).set(as('admin')).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth(sessions.accessToken))).status).toBe(403);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: sessions.refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'stu2@t.local', password: PASSWORD })).status).toBe(403);
    await request(app).patch(`/api/users/${victim._id}`).set(as('admin')).send({ isActive: true });
    expect((await request(app).post('/api/auth/login').send({ email: 'stu2@t.local', password: PASSWORD })).status).toBe(200);
  });

  test('admin password reset issues a temporary password, forces a change and is audited', async () => {
    const target = await User.findOne({ email: 'parent@t.local' });
    const res = await request(app).post(`/api/users/${target._id}/reset-password`).set(as('admin'));
    expect(res.status).toBe(200);
    const temp = res.body.data.temporaryPassword;
    expect(temp).toBeTruthy();
    expect((await request(app).post('/api/auth/login').send({ email: 'parent@t.local', password: PASSWORD })).status).toBe(401);
    const again = await login(app, 'parent@t.local', temp);
    expect(again.user.mustChangePassword).toBe(true);
    const logs = await AuditLog.find({ action: 'USER_PASSWORD_RESET_BY_ADMIN' });
    expect(logs.length).toBe(1);
    expect(JSON.stringify(logs)).not.toContain(temp);
  });
});

describe('faculty management', () => {
  const payload = (n) => ({
    employeeId: `FX${n}`,
    firstName: 'New',
    lastName: `Teacher${n}`,
    email: `teacher${n}@t.local`,
    department: String(fx.dept._id),
    designation: 'Lecturer',
  });

  test('creates, reads, updates and exports faculty (admin only for writes)', async () => {
    const denied = await request(app).post('/api/faculty').set(as('fac1')).send(payload(1));
    expect(denied.status).toBe(403);

    const created = await request(app).post('/api/faculty').set(as('admin')).send(payload(1));
    expect(created.status).toBe(201);
    const id = created.body.data.faculty._id;
    expect(created.body.data.temporaryPassword).toBeTruthy();

    const dup = await request(app).post('/api/faculty').set(as('admin')).send(payload(1));
    expect(dup.status).toBe(409);

    const badDept = await request(app)
      .post('/api/faculty')
      .set(as('admin'))
      .send({ ...payload(2), department: '64b64b64b64b64b64b64b64b' });
    expect(badDept.status).toBe(400);

    const one = await request(app).get(`/api/faculty/${id}`).set(as('fac1'));
    expect(one.status).toBe(200);
    expect(one.body.data.subjects).toEqual([]);

    const patch = await request(app)
      .patch(`/api/faculty/${id}`)
      .set(as('admin'))
      .send({ designation: 'Senior Lecturer', lastName: 'Renamed' });
    expect(patch.status).toBe(200);
    const user = await User.findOne({ email: 'teacher1@t.local' });
    expect(user.name).toBe('New Renamed');

    const list = await request(app).get('/api/faculty?search=Renamed').set(as('admin'));
    expect(list.body.data.length).toBe(1);

    const csv = await request(app).get('/api/faculty/export').set(as('admin'));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('FX1');
    expect((await request(app).get('/api/faculty/export').set(as('fac1'))).status).toBe(403);
  });

  test('deactivating a faculty member disables the login; activating restores it', async () => {
    const f = await Faculty.findOne({ employeeId: 'FX1' });
    const off = await request(app).delete(`/api/faculty/${f._id}`).set(as('admin'));
    expect(off.status).toBe(200);
    expect((await User.findById(f.user)).isActive).toBe(false);
    const on = await request(app).post(`/api/faculty/${f._id}/activate`).set(as('admin'));
    expect(on.status).toBe(200);
    expect((await User.findById(f.user)).isActive).toBe(true);
    expect((await request(app).get('/api/faculty/not-an-id').set(as('admin'))).status).toBe(400);
  });

  test('faculty can read their own profile; others cannot', async () => {
    const me = await request(app).get('/api/faculty/me').set(as('fac1'));
    expect(me.status).toBe(200);
    expect(me.body.data.subjects.map((s) => s.code)).toContain('CS101');
    expect((await request(app).get('/api/faculty/me').set(as('stu1'))).status).toBe(403);
  });

  test('assigning subjects moves ownership and validates ids', async () => {
    const f = await Faculty.findOne({ employeeId: 'FX1' });
    const res = await request(app)
      .put(`/api/faculty/${f._id}/subjects`)
      .set(as('admin'))
      .send({ subjects: [String(fx.sub2._id)] });
    expect(res.status).toBe(200);
    expect(res.body.data.subjects.map((s) => s.code)).toEqual(['CS102']);
    expect(String((await Subject.findById(fx.sub2._id)).faculty)).toBe(String(f._id));

    const missing = await request(app)
      .put(`/api/faculty/${f._id}/subjects`)
      .set(as('admin'))
      .send({ subjects: ['64b64b64b64b64b64b64b64b'] });
    expect(missing.status).toBe(400);
    // restore for other tests
    await Subject.updateOne({ _id: fx.sub2._id }, { faculty: fx.f2._id });
  });
});

describe('settings, calendar and audit logs', () => {
  test('anyone can read public branding; only admins change settings', async () => {
    const pub = await request(app).get('/api/settings/public');
    expect(pub.status).toBe(200);
    expect(pub.body.data.collegeName).toBeTruthy();
    expect(pub.body.data.attendanceThreshold).toBeUndefined();

    expect((await request(app).put('/api/settings').set(as('stu1')).send({ collegeName: 'Hacked' })).status).toBe(403);
    const upd = await request(app).put('/api/settings').set(as('admin')).send({ collegeName: 'Test Institute', attendanceThreshold: 80 });
    expect(upd.status).toBe(200);
    expect((await request(app).get('/api/settings/public')).body.data.collegeName).toBe('Test Institute');
    expect((await request(app).get('/api/settings').set(as('stu1'))).body.data.attendanceThreshold).toBe(80);
  });

  test('rejects invalid settings and grade scales', async () => {
    const badScale = await request(app)
      .put('/api/settings')
      .set(as('admin'))
      .send({
        gradeScale: [
          { grade: 'A', minPercent: 50, points: 10 },
          { grade: 'B', minPercent: 40, points: 5 },
        ],
      });
    expect(badScale.status).toBe(400);
    expect((await request(app).put('/api/settings').set(as('admin')).send({ attendanceThreshold: 400 })).status).toBe(400);
  });

  test('logo upload accepts a real PNG only', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const good = await request(app)
      .post('/api/settings/logo')
      .set(as('admin'))
      .attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(good.status).toBe(200);
    expect(good.body.data.logo).toMatch(/^photos\/[a-f0-9]+\.png$/);
    const fake = await request(app)
      .post('/api/settings/logo')
      .set(as('admin'))
      .attach('logo', Buffer.from('<script>alert(1)</script>'), { filename: 'logo.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const none = await request(app).post('/api/settings/logo').set(as('admin'));
    expect(none.status).toBe(400);
    expect(
      (await request(app).post('/api/settings/logo').set(as('stu1')).attach('logo', png, { filename: 'l.png', contentType: 'image/png' }))
        .status
    ).toBe(403);
  });

  test('calendar events are audience-scoped and admin-managed', async () => {
    const mk = (title, audience) =>
      request(app)
        .post('/api/calendar')
        .set(as('admin'))
        .send({ title, audience, type: 'event', startDate: '2030-01-10', endDate: '2030-01-11' });
    expect((await mk('For everyone', 'all')).status).toBe(201);
    expect((await mk('Faculty only', 'faculty')).status).toBe(201);
    const bad = await request(app)
      .post('/api/calendar')
      .set(as('admin'))
      .send({ title: 'Backwards', startDate: '2030-02-10', endDate: '2030-02-01' });
    expect(bad.status).toBe(400);
    expect((await request(app).post('/api/calendar').set(as('stu1')).send({ title: 'Nope', startDate: '2030-01-01' })).status).toBe(403);

    const forStudent = (await request(app).get('/api/calendar').set(as('stu1'))).body.data.map((e) => e.title);
    expect(forStudent).toContain('For everyone');
    expect(forStudent).not.toContain('Faculty only');
    const forFaculty = (await request(app).get('/api/calendar').set(as('fac1'))).body.data.map((e) => e.title);
    expect(forFaculty).toContain('Faculty only');

    const ranged = await request(app).get('/api/calendar?from=2031-01-01').set(as('admin'));
    expect(ranged.body.data).toEqual([]);

    const ev = (await request(app).get('/api/calendar?search=everyone').set(as('admin'))).body.data[0];
    expect((await request(app).patch(`/api/calendar/${ev._id}`).set(as('admin')).send({ title: 'Renamed event' })).status).toBe(200);
    expect((await request(app).delete(`/api/calendar/${ev._id}`).set(as('admin'))).status).toBe(200);
    expect((await request(app).get(`/api/calendar/${ev._id}`).set(as('admin'))).status).toBe(404);
  });

  test('audit logs are admin-only, filterable and list the recorded actions', async () => {
    expect((await request(app).get('/api/audit-logs').set(as('fac1'))).status).toBe(403);
    const all = await request(app).get('/api/audit-logs?action=SETTINGS_UPDATED').set(as('admin'));
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThan(0);
    const actions = await request(app).get('/api/audit-logs/actions').set(as('admin'));
    expect(actions.body.data).toContain('SETTINGS_UPDATED');
    const ranged = await request(app).get('/api/audit-logs?from=2000-01-01&to=2000-01-02').set(as('admin'));
    expect(ranged.body.data).toEqual([]);
  });
});

describe('study materials', () => {
  test('faculty upload to their own subject; students see them; outsiders cannot', async () => {
    const pdf = Buffer.from('%PDF-1.4 notes');
    const up = await request(app)
      .post('/api/materials')
      .set(as('fac1'))
      .field('title', 'Week 1 notes')
      .field('subject', String(fx.sub1._id))
      .attach('file', pdf, { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);

    const foreign = await request(app)
      .post('/api/materials')
      .set(as('fac1'))
      .field('title', 'Not mine')
      .field('subject', String(fx.sub2._id))
      .attach('file', pdf, { filename: 'notes.pdf', contentType: 'application/pdf' });
    expect(foreign.status).toBe(403);

    const none = await request(app).post('/api/materials').set(as('fac1')).field('title', 'No file').field('subject', String(fx.sub1._id));
    expect(none.status).toBe(400);

    const asStudent = await request(app)
      .post('/api/materials')
      .set(as('stu1'))
      .field('title', 'x')
      .field('subject', String(fx.sub1._id))
      .attach('file', pdf, { filename: 'n.pdf', contentType: 'application/pdf' });
    expect(asStudent.status).toBe(403);

    const seen = await request(app).get('/api/materials').set(as('stu1'));
    expect(seen.body.data.map((m) => m.title)).toContain('Week 1 notes');

    const id = up.body.data._id;
    expect((await request(app).delete(`/api/materials/${id}`).set(as('fac2'))).status).toBe(403);
    expect((await request(app).delete(`/api/materials/${id}`).set(as('fac1'))).status).toBe(200);
    expect((await request(app).delete(`/api/materials/${id}`).set(as('fac1'))).status).toBe(404);
  });
});
