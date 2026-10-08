import request from './support/request';
import { setupDb, teardownDb, makeFixtures, auth } from './helpers';
import { User, Student, Faculty, Fee, FeeStructure } from '@/models';
import { toCsv } from '@/lib/csv';

const ok = async (p: any) => {
  const r = await p;
  expect(r.status).toBe(200);
  return r;
};

let app: any;
let fx: any;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

describe('clearing optional fields on update', () => {
  test('student: null clears phone and section', async () => {
    const id = String(fx.students[0]._id);
    await ok(request(app).patch(`/api/students/${id}`).set(auth(fx.tokens.admin)).send({ phone: '9876543210', batch: '2025' }));
    const res = await request(app)
      .patch(`/api/students/${id}`)
      .set(auth(fx.tokens.admin))
      .send({ phone: null, batch: null, guardian: { name: null } });
    expect(res.status).toBe(200);
    const s: any = await Student.findById(id).lean();
    expect(s.phone ?? null).toBeNull();
    expect(s.batch ?? null).toBeNull();
  });

  test('faculty: null clears phone and designation, and the field is really unset', async () => {
    const id = String(fx.f1._id);
    await ok(request(app).patch(`/api/faculty/${id}`).set(auth(fx.tokens.admin)).send({ phone: '9876543210', designation: 'Professor' }));
    const res = await request(app).patch(`/api/faculty/${id}`).set(auth(fx.tokens.admin)).send({ phone: null, designation: '' });
    expect(res.status).toBe(200);
    const f: any = await Faculty.findById(id).lean();
    expect(f.phone).toBeUndefined();
    expect(f.designation).toBeUndefined();
  });
});

describe('faculty email change', () => {
  test('is rejected when another account uses it, and nothing is saved', async () => {
    const id = String(fx.f1._id);
    const res = await request(app).patch(`/api/faculty/${id}`).set(auth(fx.tokens.admin)).send({ email: 'admin@t.local', firstName: 'Changed' });
    expect(res.status).toBe(409);
    const f: any = await Faculty.findById(id).lean();
    expect(f.email).toBe('fac1@t.local');
    expect(f.firstName).toBe('Fac');
  });

  test('updates the login account too', async () => {
    const id = String(fx.f2._id);
    await ok(request(app).patch(`/api/faculty/${id}`).set(auth(fx.tokens.admin)).send({ email: 'fac2.new@t.local' }));
    const f: any = await Faculty.findById(id).lean();
    expect((await User.findById(f.user).lean() as any).email).toBe('fac2.new@t.local');
  });
});

describe('user admin', () => {
  let parentId: string;
  beforeAll(async () => {
    parentId = String((await User.findOne({ email: 'parent@t.local' }))!._id);
  });

  test('email can be changed and must stay unique', async () => {
    const clash = await request(app).patch(`/api/users/${parentId}`).set(auth(fx.tokens.admin)).send({ email: 'admin@t.local' });
    expect(clash.status).toBe(409);
    const studentClash = await request(app).patch(`/api/users/${parentId}`).set(auth(fx.tokens.admin)).send({ email: 'stu2@t.local' });
    expect(studentClash.status).toBe(409);
    const ok = await request(app).patch(`/api/users/${parentId}`).set(auth(fx.tokens.admin)).send({ email: 'Parent.New@t.local' });
    expect(ok.status).toBe(200);
    expect((await User.findById(parentId))!.email).toBe('parent.new@t.local');
  });

  test('linked students must exist and only apply to parents', async () => {
    const missing = await request(app)
      .patch(`/api/users/${parentId}`)
      .set(auth(fx.tokens.admin))
      .send({ children: ['64b64c0f1f1f1f1f1f1f1f1f'] });
    expect(missing.status).toBe(400);
    const adminUser = String((await User.findOne({ email: 'admin@t.local' }))!._id);
    const notParent = await request(app)
      .patch(`/api/users/${adminUser}`)
      .set(auth(fx.tokens.admin))
      .send({ children: [String(fx.students[0]._id)] });
    expect(notParent.status).toBe(400);
    // the edit form always sends the hidden, empty list: that must not block editing an admin account
    const formEdit = await request(app).patch(`/api/users/${adminUser}`).set(auth(fx.tokens.admin)).send({ name: 'Admin Renamed', children: [] });
    expect(formEdit.status).toBe(200);
    const good = await request(app)
      .patch(`/api/users/${parentId}`)
      .set(auth(fx.tokens.admin))
      .send({ children: [String(fx.students[1]._id)] });
    expect(good.status).toBe(200);
  });

  test('deactivating and reactivating a student account keeps the profile status in step', async () => {
    const s = fx.students[2];
    await ok(request(app).patch(`/api/users/${s.user}`).set(auth(fx.tokens.admin)).send({ isActive: false }));
    expect((await Student.findById(s._id))!.status).toBe('inactive');
    await ok(request(app).patch(`/api/users/${s.user}`).set(auth(fx.tokens.admin)).send({ isActive: true }));
    expect((await Student.findById(s._id))!.status).toBe('active');
  });
});

describe('CSV cells', () => {
  const csv = (v: string) => toCsv([{ v }], [{ label: 'v', value: 'v' }]).split('\r\n')[1];
  test('keeps phone numbers and plain negative numbers, neutralises formulas', () => {
    expect(csv('+919876543210')).toBe('+919876543210');
    expect(csv('+91 98765-43210')).toBe('+91 98765-43210');
    expect(csv('-12.5')).toBe('-12.5');
    expect(csv('=1+1')).toBe("'=1+1");
    expect(csv('+1+2')).toBe("'+1+2");
    expect(csv('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csv('-1+cmd')).toBe("'-1+cmd");
    expect(csv('\tx')).toBe("'\tx");
  });
});

describe('reports', () => {
  test('marks and placements search by student name/ID', async () => {
    const { Mark } = await import('@/models');
    for (const s of [fx.students[0], fx.students[1]])
      await Mark.create({ student: s._id, subject: fx.sub1._id, examType: 'quiz', marksObtained: 5, maxMarks: 10, semester: 2, enteredBy: fx.f1.user }).catch(() => null);
    const all = await request(app).get('/api/reports/marks').set(auth(fx.tokens.admin));
    const some = await request(app).get('/api/reports/marks?search=S1').set(auth(fx.tokens.admin));
    expect(some.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(some.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(some.body.meta.total).toBeLessThan(all.body.meta.total);
    expect(some.body.meta.total).toBeLessThanOrEqual(all.body.meta.total);
    for (const r of some.body.data.rows) expect(String(r['Student ID'])).toBe('S1');
    const none = await request(app).get('/api/reports/marks?search=zzzz').set(auth(fx.tokens.admin));
    expect(none.body.meta.total).toBe(0);
    const pl = await request(app).get('/api/reports/placements?search=zzzz').set(auth(fx.tokens.admin));
    expect(pl.status).toBe(200);
    expect(pl.body.meta.total).toBe(0);
  });

  test('fees status filter is applied in the database and meta carries the export limit', async () => {
    const structure: any = await FeeStructure.create({
      name: 'Tuition', program: fx.program._id, semester: 2, amount: 1000, dueDate: new Date(Date.now() - 86400000),
    } as any).catch(() => null);
    await Fee.create({ student: fx.students[0]._id, title: 'T', amountDue: 1000, amountPaid: 1000, dueDate: new Date(), ...(structure ? { structure: structure._id } : {}) } as any).catch(() => null);
    await Fee.create({ student: fx.students[1]._id, title: 'T', amountDue: 1000, amountPaid: 0, dueDate: new Date(Date.now() - 86400000 * 3), ...(structure ? { structure: structure._id } : {}) } as any).catch(() => null);
    const res = await request(app).get('/api/reports/fees?status=overdue').set(auth(fx.tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of res.body.data.rows) expect(r.Status).toBe('overdue');
    expect(res.body.meta.exportLimit).toBe(5000);
    expect(res.body.meta.truncated).toBe(false);
  });

  test('students report paginates in the database', async () => {
    const res = await request(app).get('/api/reports/students?limit=2&page=2').set(auth(fx.tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.meta.total).toBe(4);
  });
});

describe('student import', () => {
  test('a blank semester cell defaults to 1', async () => {
    const csv = 'studentId,firstName,lastName,email,phone,gender,dateOfBirth,departmentCode,programCode,semester,batch,section\nS777,A,B,a.b@t.local,,,,CSE,BTCSE,,,\n';
    const res = await request(app).post('/api/import/students/preview').set(auth(fx.tokens.admin)).attach('file', Buffer.from(csv), { filename: 'x.csv', contentType: 'text/csv' });
    expect(res.status).toBe(200);
    expect(res.body.data.validCount).toBe(1);
  });
});
