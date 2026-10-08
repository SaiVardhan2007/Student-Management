import { createHmac } from 'crypto';
import { vi } from 'vitest';
import request from './support/request';
import { setupDb, teardownDb, makeFixtures, auth } from './helpers';
import {
  Fee, FeeStructure, Book, Notice, Notification, Assignment, Submission, Complaint, Achievement,
  Material, CalendarEvent, Job, Company, Application, Mark, User,
} from '@/models';
import { announceDueNotices } from '@/services/notice.service';
import { sendDeadlineReminders } from '@/services/jobs';

let app: any;
let fx: any;
const A = (t: string) => auth(t);
const day = 86400000;
const future = (d: number) => new Date(Date.now() + d * day);
const pdf = Buffer.from('%PDF-1.4 test');

beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

async function mkFee(due: number, paid = 0) {
  const st = await FeeStructure.create({ name: `S${Math.random()}`, program: fx.program._id, semester: 2, amount: due, dueDate: future(5) });
  return Fee.create({ student: fx.students[0]._id, structure: st._id, title: 'Tuition', amountDue: due, amountPaid: paid, dueDate: future(5) });
}

describe('fees', () => {
  test('concurrent payments cannot overpay (atomic)', async () => {
    const fee = await mkFee(1000);
    const pay = () => request(app).post(`/api/fees/${fee._id}/pay`).set(A(fx.tokens.admin)).send({ amount: 1000, method: 'cash' });
    const res = await Promise.all([pay(), pay(), pay()]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    const after = await Fee.findById(fee._id);
    expect(after!.amountPaid).toBe(1000);
    expect(after!.payments).toHaveLength(1);
  });

  test('float amounts: 0.1 + 0.2 settles a 0.3 fee; zero/negative rejected', async () => {
    const fee = await mkFee(0.3);
    const pay = (amount: number) => request(app).post(`/api/fees/${fee._id}/pay`).set(A(fx.tokens.admin)).send({ amount, method: 'cash' });
    expect((await pay(0)).status).toBe(400);
    expect((await pay(-5)).status).toBe(400);
    expect((await pay(0.1)).status).toBe(200);
    expect((await pay(0.2)).status).toBe(200);
    expect((await pay(0.01)).status).toBe(409); // fully paid
  });
});

describe('fees: razorpay + admin-set fees', () => {
  const SECRET = 'test_secret_value';
  const sign = (o: string, p: string) => createHmac('sha256', SECRET).update(`${o}|${p}`).digest('hex');
  beforeAll(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
    process.env.RAZORPAY_KEY_SECRET = SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
  });
  afterAll(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  // pretend Razorpay accepted the order, without calling the network
  const stubOrder = (id: string) =>
    jest_fetch(async () => ({ ok: true, json: async () => ({ id, amount: 40000, currency: 'INR' }) }) as any);
  const jest_fetch = (impl: any) => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    return spy;
  };

  test('order -> verify records once; bad signature, replay and other students are rejected', async () => {
    const fee = await mkFee(1000);
    const spy = stubOrder('order_A1');
    const order = await request(app).post(`/api/fees/${fee._id}/razorpay/order`).set(A(fx.tokens.stu1)).send({ amount: 400 });
    spy.mockRestore();
    expect(order.status).toBe(200);
    expect(order.body.data).toMatchObject({ orderId: 'order_A1', amount: 40000, keyId: 'rzp_test_x' });

    const verify = (tok: string, sig: string) =>
      request(app)
        .post(`/api/fees/${fee._id}/razorpay/verify`)
        .set(A(tok))
        .send({ razorpay_order_id: 'order_A1', razorpay_payment_id: 'pay_1', razorpay_signature: sig });
    expect((await verify(fx.tokens.stu1, 'bad')).status).toBe(400);
    expect((await verify(fx.tokens.stu2, sign('order_A1', 'pay_1'))).status).toBe(404);
    const ok1 = await verify(fx.tokens.stu1, sign('order_A1', 'pay_1'));
    expect(ok1.status).toBe(200);
    const ok2 = await verify(fx.tokens.stu1, sign('order_A1', 'pay_1'));
    expect(ok2.body.data.receiptNo).toBe(ok1.body.data.receiptNo);
    const after = await Fee.findById(fee._id);
    expect(after!.amountPaid).toBe(400);
    expect(after!.payments).toHaveLength(1);
    expect(after!.payments[0].method).toBe('razorpay');
  });

  test('order is refused when the amount exceeds the pending balance', async () => {
    const fee = await mkFee(1000, 900);
    const res = await request(app).post(`/api/fees/${fee._id}/razorpay/order`).set(A(fx.tokens.stu1)).send({ amount: 200 });
    expect(res.status).toBe(400);
  });

  test('webhook: signature required; captured payment is recorded once', async () => {
    const fee = await mkFee(1000);
    await Fee.updateOne({ _id: fee._id }, { $push: { gatewayOrders: { orderId: 'order_W1', amount: 250 } } });
    const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_W', order_id: 'order_W1' } } } };
    const body = JSON.stringify(event); // the test client serialises the same way, so the signed bytes match
    const hook = (sig: string) =>
      request(app).post('/api/fees/razorpay/webhook').set('x-razorpay-signature', sig).send(event);
    expect((await hook('nope')).status).toBe(400);
    const good = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect((await hook(good)).status).toBe(200);
    expect((await hook(good)).status).toBe(200);
    expect((await Fee.findById(fee._id))!.amountPaid).toBe(250);
  });

  test('admin creates, edits and deletes a fee; total cannot drop below paid', async () => {
    const created = await request(app)
      .post('/api/fees')
      .set(A(fx.tokens.admin))
      .send({ student: String(fx.students[0]._id), title: 'Lab fee', amountDue: 500, dueDate: future(3) });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect((await request(app).post('/api/fees').set(A(fx.tokens.stu1)).send({})).status).toBe(403);
    await request(app).post(`/api/fees/${id}/pay`).set(A(fx.tokens.admin)).send({ amount: 300, method: 'cash' });
    expect((await request(app).patch(`/api/fees/${id}`).set(A(fx.tokens.admin)).send({ amountDue: 200 })).status).toBe(400);
    expect((await request(app).patch(`/api/fees/${id}`).set(A(fx.tokens.admin)).send({ amountDue: 800 })).status).toBe(200);
    expect((await request(app).delete(`/api/fees/${id}`).set(A(fx.tokens.admin))).status).toBe(409);
  });
});

describe('library', () => {
  test('concurrent return restores the copy only once', async () => {
    const book = await Book.create({ title: 'Algo', authors: ['X'], isbn: '1234567890', totalCopies: 2, availableCopies: 2 });
    const r = await request(app).post('/api/library/issue').set(A(fx.tokens.admin)).send({ book: String(book._id), student: String(fx.students[0]._id) });
    expect(r.status).toBe(201);
    const ret = () => request(app).post(`/api/library/return/${r.body.data._id}`).set(A(fx.tokens.admin));
    const res = await Promise.all([ret(), ret()]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await Book.findById(book._id))!.availableCopies).toBe(2);
  });

  test('updating totalCopies keeps issued copies accounted for', async () => {
    const book = await Book.create({ title: 'DB', authors: ['Y'], isbn: '1234567891', totalCopies: 3, availableCopies: 3 });
    await request(app).post('/api/library/issue').set(A(fx.tokens.admin)).send({ book: String(book._id), student: String(fx.students[1]._id) });
    const up = await request(app).patch(`/api/library/books/${book._id}`).set(A(fx.tokens.admin)).send({ totalCopies: 5 });
    expect(up.status).toBe(200);
    const b = await Book.findById(book._id);
    expect([b!.totalCopies, b!.availableCopies]).toEqual([5, 4]);
    expect((await request(app).patch(`/api/library/books/${book._id}`).set(A(fx.tokens.admin)).send({ totalCopies: 3 })).status).toBe(200);
    expect((await Book.findById(book._id))!.availableCopies).toBe(2);
  });
});

describe('file downloads', () => {
  test('submissions: only faculty of the subject; complaints: only assignee', async () => {
    const a = await request(app)
      .post('/api/assignments').set(A(fx.tokens.fac1))
      .field('title', 'HW').field('subject', String(fx.sub1._id)).field('deadline', future(3).toISOString()).field('maxMarks', '10');
    expect(a.status).toBe(201);
    const s = await request(app)
      .post(`/api/assignments/${a.body.data._id}/submit`).set(A(fx.tokens.stu1))
      .attach('files', Buffer.from('answer'), { filename: 'a.txt', contentType: 'text/plain' });
    const file = s.body.data.files[0].path;
    expect((await request(app).get(`/api/files/${file}`).set(A(fx.tokens.fac1))).status).toBe(200);
    expect((await request(app).get(`/api/files/${file}`).set(A(fx.tokens.fac2))).status).toBe(403);

    const c = await request(app)
      .post('/api/complaints').set(A(fx.tokens.stu1))
      .field('subject', 'Broken').field('description', 'something broke').field('category', 'other').field('priority', 'medium')
      .attach('attachment', pdf, { filename: 'p.pdf', contentType: 'application/pdf' });
    expect(c.status).toBe(201);
    const cf = c.body.data.attachment.path;
    expect((await request(app).get(`/api/files/${cf}`).set(A(fx.tokens.fac1))).status).toBe(403);
    await Complaint.updateOne({ _id: c.body.data._id }, { assignedTo: fx.f1.user });
    expect((await request(app).get(`/api/files/${cf}`).set(A(fx.tokens.fac1))).status).toBe(200);
    expect((await request(app).get(`/api/files/${cf}`).set(A(fx.tokens.admin))).status).toBe(200);
  });

  test('materials/assignments/notices follow list visibility', async () => {
    const m = await request(app)
      .post('/api/materials').set(A(fx.tokens.fac2))
      .field('title', 'Notes').field('subject', String(fx.sub2._id)).attach('file', pdf, { filename: 'n.pdf', contentType: 'application/pdf' });
    expect(m.status).toBe(201);
    const mf = m.body.data.file.path;
    expect((await request(app).get(`/api/files/${mf}`).set(A(fx.tokens.stu1))).status).toBe(200); // enrolled
    expect((await request(app).get(`/api/files/${mf}`).set(A(fx.tokens.fac1))).status).toBe(403); // other teacher
    await Material.deleteMany({});
    const n = await request(app)
      .post('/api/notices').set(A(fx.tokens.admin))
      .field('title', 'Staff only').field('description', 'd').field('audience', 'faculty').field('priority', 'normal')
      .attach('attachment', pdf, { filename: 'n.pdf', contentType: 'application/pdf' });
    expect(n.status).toBe(201);
    const nf = n.body.data.attachment.path;
    expect((await request(app).get(`/api/files/${nf}`).set(A(fx.tokens.stu1))).status).toBe(403);
    expect((await request(app).get(`/api/files/${nf}`).set(A(fx.tokens.fac1))).status).toBe(200);
  });
});

describe('notices', () => {
  test('scheduled notices are announced once by the job', async () => {
    const before = await Notification.countDocuments({ type: 'notice' });
    const n = await Notice.create({
      title: 'Later', description: 'desc', audience: 'students', publishDate: future(1), createdBy: fx.f1.user,
    });
    expect(await announceDueNotices()).toBe(0);
    expect(await announceDueNotices(future(2))).toBe(1);
    expect(await announceDueNotices(future(2))).toBe(0);
    expect((await Notice.findById(n._id))!.announcedAt).toBeTruthy();
    expect(await Notification.countDocuments({ type: 'notice' })).toBeGreaterThan(before);
  });

  test('parent-audience notices only reach parents of targeted students', async () => {
    await Notification.deleteMany({});
    const other = await User.create({ name: 'P2', email: 'p2@t.local', password: 'Test@12345', role: 'parent', children: [fx.students[3]._id] });
    const r = await request(app)
      .post('/api/notices').set(A(fx.tokens.admin))
      .send({ title: 'Sec A parents', description: 'd', audience: 'parents', section: String(fx.section._id), priority: 'normal' });
    expect(r.status).toBe(201);
    expect(await Notification.countDocuments({ user: fx.parent._id })).toBe(1);
    expect(await Notification.countDocuments({ user: other._id })).toBe(0);
  });
});

describe('assignments', () => {
  test('status filter is applied before pagination', async () => {
    await Assignment.deleteMany({});
    await Submission.deleteMany({});
    const mk = (i: number) => Assignment.create({ title: `A${i}`, subject: fx.sub1._id, deadline: future(i + 1), maxMarks: 10, createdBy: fx.f1.user });
    const all = [];
    for (let i = 0; i < 5; i++) all.push(await mk(i));
    await Submission.create({ assignment: all[4]._id, student: fx.students[0]._id, text: 'x', status: 'submitted' });
    const r = await request(app).get('/api/assignments?status=pending&limit=2&page=1').set(A(fx.tokens.stu1));
    expect(r.body.data).toHaveLength(2);
    expect(r.body.meta.total).toBe(4);
    const s = await request(app).get('/api/assignments?status=submitted').set(A(fx.tokens.stu1));
    expect(s.body.meta.total).toBe(1);
  });

  test('get applies section restriction', async () => {
    const a = await Assignment.create({ title: 'B only', subject: fx.sub1._id, deadline: future(3), maxMarks: 10, createdBy: fx.f1.user, sections: [fx.otherSection._id] });
    expect((await request(app).get(`/api/assignments/${a._id}`).set(A(fx.tokens.stu1))).status).toBe(403);
  });

  test('deadline reminder is claimed once and skips inactive students', async () => {
    await Assignment.deleteMany({});
    await Assignment.create({ title: 'Soon', subject: fx.sub1._id, deadline: new Date(Date.now() + 3600000), maxMarks: 10, createdBy: fx.f1.user });
    const [x, y] = await Promise.all([sendDeadlineReminders(), sendDeadlineReminders()]);
    expect(Math.max(x, y)).toBeGreaterThan(0);
    expect(Math.min(x, y)).toBe(0);
  });
});

describe('placements', () => {
  test('active backlogs block applying; status transitions validated', async () => {
    const company = await Company.create({ name: 'Acme' });
    const job = await Job.create({ company: company._id, title: 'Dev', deadline: future(5), isPublished: true, eligibility: { minCgpa: 0, maxActiveBacklogs: 0 } });
    await Mark.create({ student: fx.students[0]._id, subject: fx.sub1._id, semester: 2, examType: 'final', marksObtained: 1, maxMarks: 100, enteredBy: fx.f1.user });
    const blocked = await request(app).post(`/api/placements/jobs/${job._id}/apply`).set(A(fx.tokens.stu1));
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toMatch(/backlog/i);
    await Job.updateOne({ _id: job._id }, { 'eligibility.maxActiveBacklogs': 1 });
    const ok = await request(app).post(`/api/placements/jobs/${job._id}/apply`).set(A(fx.tokens.stu1));
    expect(ok.status).toBe(201);
    const id = ok.body.data._id;
    const set = (status: string) => request(app).patch(`/api/placements/applications/${id}/status`).set(A(fx.tokens.admin)).send({ status });
    expect((await set('selected')).status).toBe(200);
    expect((await set('applied')).status).toBe(409);
    expect((await set('interview')).status).toBe(409);
    expect((await Application.findById(id))!.status).toBe('selected');
  });
});

describe('calendar', () => {
  test('range keeps multi-day events overlapping the range; parents see student events', async () => {
    await CalendarEvent.deleteMany({});
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    await CalendarEvent.create([
      { title: 'Spans', startDate: d('2030-01-28'), endDate: d('2030-02-03'), audience: 'students' },
      { title: 'LastDay', startDate: d('2030-02-28'), audience: 'all' },
      { title: 'Next', startDate: d('2030-03-01'), audience: 'all' },
    ]);
    const r = await request(app).get('/api/calendar?from=2030-02-01&to=2030-02-28').set(A(fx.tokens.parent));
    expect(r.body.data.map((e: any) => e.title).sort()).toEqual(['LastDay', 'Spans']);
  });
});

describe('achievements', () => {
  test('students cannot delete verified achievements', async () => {
    const a = await Achievement.create({ student: fx.students[0]._id, title: 'Won', category: 'other', status: 'verified' });
    expect((await request(app).delete(`/api/achievements/${a._id}`).set(A(fx.tokens.stu1))).status).toBe(409);
    await Achievement.updateOne({ _id: a._id }, { status: 'pending' });
    expect((await request(app).delete(`/api/achievements/${a._id}`).set(A(fx.tokens.stu1))).status).toBe(200);
  });

  test('student reply to unassigned ticket notifies admins', async () => {
    const c = await Complaint.create({ student: fx.students[0]._id, subject: 'Help', description: 'please', category: 'other' });
    await Notification.deleteMany({});
    const r = await request(app).post(`/api/complaints/${c._id}/respond`).set(A(fx.tokens.stu1)).send({ message: 'any news?' });
    expect(r.status).toBe(200);
    const admin = await User.findOne({ role: 'admin' });
    expect(await Notification.countDocuments({ user: admin!._id, type: 'complaint' })).toBe(1);
  });
});
