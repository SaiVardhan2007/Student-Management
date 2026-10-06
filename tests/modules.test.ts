import request from './support/request';
import fs from 'fs';
import path from 'path';
import { setupDb, teardownDb, makeFixtures, login, auth } from './helpers';
import { Notification, Assignment, Subject, Book, Student, AuditLog } from '@/models';
import { sendDeadlineReminders } from '@/services/jobs';

let app: any;
let fx: any;
let stu1;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
  stu1 = fx.tokens.stu1;
}, 120000);
afterAll(teardownDb);

const future = (d) => new Date(Date.now() + d * 86400000).toISOString();
const A = (t: string) => auth(t);

describe('academic structure', () => {
  test('departments CRUD, uniqueness and protected deletion', async () => {
    const create = await request(app).post('/api/departments').set(A(fx.tokens.admin)).send({ name: 'Physics', code: 'phy' });
    expect(create.status).toBe(201);
    expect(create.body.data.code).toBe('PHY');
    expect((await request(app).post('/api/departments').set(A(fx.tokens.admin)).send({ name: 'Physics 2', code: 'PHY' })).status).toBe(409);
    expect((await request(app).delete(`/api/departments/${fx.dept._id}`).set(A(fx.tokens.admin))).status).toBe(409); // has programs/students
    expect((await request(app).delete(`/api/departments/${create.body.data._id}`).set(A(fx.tokens.admin))).status).toBe(200);
    expect((await request(app).get('/api/departments').set(A(stu1))).status).toBe(200); // read is open to authenticated users
  });

  test('only one academic year can be current', async () => {
    const mk = (name, cur) =>
      request(app)
        .post('/api/academic-years')
        .set(A(fx.tokens.admin))
        .send({ name, startDate: '2025-06-01', endDate: '2026-05-31', isCurrent: cur });
    await mk('2024-25', true);
    await mk('2025-26', true);
    const list = await request(app).get('/api/academic-years?isCurrent=true').set(A(fx.tokens.admin));
    expect(list.body.data.map((y) => y.name)).toEqual(['2025-26']);
    expect(
      (
        await request(app)
          .post('/api/academic-years')
          .set(A(fx.tokens.admin))
          .send({ name: 'bad', startDate: '2026-01-01', endDate: '2025-01-01' })
      ).status
    ).toBe(400);
  });

  test('new subjects auto-enrol matching students; faculty assignment works', async () => {
    const res = await request(app)
      .post('/api/subjects')
      .set(A(fx.tokens.admin))
      .send({
        code: 'cs103',
        name: 'OS',
        department: String(fx.dept._id),
        program: String(fx.program._id),
        semester: 2,
        credits: 3,
        faculty: String(fx.f1._id),
      });
    expect(res.status).toBe(201);
    const enrolled = await request(app).get(`/api/enrollments?subject=${res.body.data._id}`).set(A(fx.tokens.admin));
    expect(enrolled.body.data).toHaveLength(4);
    const mine = await request(app).get('/api/subjects?mine=true').set(A(fx.tokens.fac1));
    expect(mine.body.data.map((s) => s.code).sort()).toEqual(['CS101', 'CS103']);
    const asStudent = await request(app).get('/api/subjects?mine=true').set(A(stu1));
    expect(asStudent.body.meta.total).toBe(3);
  });
});

describe('timetable & exams', () => {
  const slot = (over?: any) => ({
    day: 'monday',
    startTime: '09:00',
    endTime: '10:00',
    subject: String(fx.sub1._id),
    faculty: String(fx.f1._id),
    room: 'R1',
    section: String(fx.section._id),
    ...over,
  });

  test('detects faculty, room and section conflicts', async () => {
    expect((await request(app).post('/api/timetable').set(A(fx.tokens.admin)).send(slot())).status).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/timetable')
          .set(A(fx.tokens.admin))
          .send(slot({ startTime: '09:30', endTime: '10:30', room: 'R2', section: String(fx.otherSection._id) }))
      ).status
    ).toBe(409); // same faculty
    expect(
      (
        await request(app)
          .post('/api/timetable')
          .set(A(fx.tokens.admin))
          .send(slot({ faculty: String(fx.f2._id), subject: String(fx.sub2._id), section: String(fx.otherSection._id) }))
      ).status
    ).toBe(409); // same room
    expect(
      (
        await request(app)
          .post('/api/timetable')
          .set(A(fx.tokens.admin))
          .send(slot({ faculty: String(fx.f2._id), subject: String(fx.sub2._id), room: 'R9' }))
      ).status
    ).toBe(409); // same section
    expect(
      (
        await request(app)
          .post('/api/timetable')
          .set(A(fx.tokens.admin))
          .send(slot({ startTime: '10:00', endTime: '11:00' }))
      ).status
    ).toBe(201); // back-to-back is fine
    expect(
      (
        await request(app)
          .post('/api/timetable')
          .set(A(fx.tokens.admin))
          .send(slot({ startTime: '11:00', endTime: '10:00' }))
      ).status
    ).toBe(400);
    expect((await request(app).post('/api/timetable').set(A(fx.tokens.fac1)).send(slot())).status).toBe(403);
  });

  test('students and faculty see their own timetable', async () => {
    const s = await request(app).get('/api/timetable/me').set(A(stu1));
    expect(s.body.data).toHaveLength(2);
    const f = await request(app).get('/api/timetable/me').set(A(fx.tokens.fac2));
    expect(f.body.data).toHaveLength(0);
  });

  test('exam room clashes rejected; only published exams reach students; seating generated', async () => {
    const exam = (over = {}) => ({
      name: 'Mid',
      type: 'mid',
      subject: String(fx.sub1._id),
      program: String(fx.program._id),
      semester: 2,
      date: future(7),
      startTime: '10:00',
      endTime: '12:00',
      room: 'Hall 1',
      ...over,
    });
    const created = await request(app).post('/api/exams').set(A(fx.tokens.admin)).send(exam());
    expect(created.status).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/exams')
          .set(A(fx.tokens.admin))
          .send(exam({ name: 'Clash', startTime: '11:00', endTime: '13:00', date: created.body.data.date }))
      ).status
    ).toBe(409);
    expect((await request(app).get('/api/exams').set(A(stu1))).body.data).toHaveLength(0); // unpublished
    await request(app).patch(`/api/exams/${created.body.data._id}`).set(A(fx.tokens.admin)).send({ isPublished: true });
    expect((await request(app).get('/api/exams').set(A(stu1))).body.data).toHaveLength(1);
    expect(await Notification.countDocuments({ type: 'exam' })).toBeGreaterThan(0);
    const seat = await request(app)
      .post(`/api/exams/${created.body.data._id}/seating`)
      .set(A(fx.tokens.admin))
      .send({ perRoomCapacity: 50 });
    expect(seat.body.data.seats).toBe(4);
    expect((await request(app).get(`/api/exams/${created.body.data._id}/my-seat`).set(A(stu1))).body.data.seat).toBe('S-001');
  });
});

describe('assignments', () => {
  let assignment;
  test('faculty creates (own subject only) and students are notified', async () => {
    const body = { title: 'HW 1', description: 'do it', subject: String(fx.sub1._id), deadline: future(2), maxMarks: 10 };
    expect((await request(app).post('/api/assignments').set(A(fx.tokens.fac2)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/assignments').set(A(stu1)).send(body)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/assignments')
          .set(A(fx.tokens.fac1))
          .send({ ...body, maxMarks: 0 })
      ).status
    ).toBe(400);
    const res = await request(app)
      .post('/api/assignments')
      .set(A(fx.tokens.fac1))
      .field('title', 'HW 1')
      .field('subject', String(fx.sub1._id))
      .field('deadline', future(2))
      .field('maxMarks', '10')
      .attach('attachment', Buffer.from('%PDF-1.4 test'), { filename: 'brief.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    assignment = res.body.data;
    expect(assignment.attachment.path).toMatch(/^assignments\/[a-f0-9]{32}\.pdf$/);
    expect(await Notification.countDocuments({ type: 'assignment' })).toBeGreaterThanOrEqual(4);
  });

  test('rejects disallowed file types and oversize files', async () => {
    const exe = await request(app)
      .post('/api/assignments')
      .set(A(fx.tokens.fac1))
      .field('title', 'x1')
      .field('subject', String(fx.sub1._id))
      .field('deadline', future(2))
      .field('maxMarks', '10')
      .attach('attachment', Buffer.from('MZ'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect(exe.status).toBe(400);
    const spoof = await request(app)
      .post('/api/assignments')
      .set(A(fx.tokens.fac1))
      .field('title', 'x2')
      .field('subject', String(fx.sub1._id))
      .field('deadline', future(2))
      .field('maxMarks', '10')
      .attach('attachment', Buffer.from('<script>'), { filename: 'a.pdf', contentType: 'text/html' });
    expect(spoof.status).toBe(400);
    // right MIME type + extension but the content is not a PDF
    const fake = await request(app)
      .post('/api/assignments')
      .set(A(fx.tokens.fac1))
      .field('title', 'x4')
      .field('subject', String(fx.sub1._id))
      .field('deadline', future(2))
      .field('maxMarks', '10')
      .attach('attachment', Buffer.from('<html><script>alert(1)</script></html>'), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });
    expect(fake.status).toBe(400);
    expect(fake.body.message).toMatch(/does not look like a valid PDF/);
    const big = await request(app)
      .post('/api/assignments')
      .set(A(fx.tokens.fac1))
      .field('title', 'x3')
      .field('subject', String(fx.sub1._id))
      .field('deadline', future(2))
      .field('maxMarks', '10')
      .attach('attachment', Buffer.alloc(11 * 1024 * 1024), { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(big.status).toBe(400);
    expect(big.body.message).toMatch(/too large/i);
  });

  test('student sees status, submits, resubmits; late flagged; faculty evaluates', async () => {
    const list = await request(app).get('/api/assignments').set(A(stu1));
    expect(list.body.data[0].submissionStatus).toBe('pending');
    const submit = await request(app)
      .post(`/api/assignments/${assignment._id}/submit`)
      .set(A(stu1))
      .field('text', 'my answer')
      .attach('files', Buffer.from('answer'), { filename: 'ans.txt', contentType: 'text/plain' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.status).toBe('submitted');
    expect((await request(app).post(`/api/assignments/${assignment._id}/submit`).set(A(stu1)).field('text', 'v2')).status).toBe(201); // resubmit allowed
    expect((await request(app).post(`/api/assignments/${assignment._id}/submit`).set(A(stu1))).status).toBe(400); // nothing attached
    // the file belongs to the owner: another student cannot download it
    const file = submit.body.data.files[0].path;
    expect((await request(app).get(`/api/files/${file}`).set(A(stu1))).status).toBe(200);
    expect((await request(app).get(`/api/files/${file}`).set(A(fx.tokens.stu2))).status).toBe(403);
    expect((await request(app).get(`/api/files/${file}`).set(A(fx.tokens.fac1))).status).toBe(200);

    const rows = await request(app).get(`/api/assignments/${assignment._id}/submissions`).set(A(fx.tokens.fac1));
    expect(rows.body.data.rows.filter((r) => r.status === 'pending')).toHaveLength(3);
    expect((await request(app).get(`/api/assignments/${assignment._id}/submissions`).set(A(fx.tokens.fac2))).status).toBe(403);
    expect(
      (await request(app).patch(`/api/assignments/submissions/${submit.body.data._id}/evaluate`).set(A(fx.tokens.fac1)).send({ marks: 11 }))
        .status
    ).toBe(400);
    const ev = await request(app)
      .patch(`/api/assignments/submissions/${submit.body.data._id}/evaluate`)
      .set(A(fx.tokens.fac1))
      .send({ marks: 8, feedback: 'good' });
    expect(ev.body.data.status).toBe('evaluated');
    expect((await request(app).post(`/api/assignments/${assignment._id}/submit`).set(A(stu1)).field('text', 'again')).status).toBe(409);

    await Assignment.updateOne({ _id: assignment._id }, { deadline: new Date(Date.now() - 1000) });
    const late = await request(app).post(`/api/assignments/${assignment._id}/submit`).set(A(fx.tokens.stu2)).field('text', 'late one');
    expect(late.body.data.status).toBe('late');
  });

  test('deadline reminder job notifies only students who have not submitted, once per assignment', async () => {
    const a = await Assignment.create({
      title: 'Due tomorrow',
      subject: fx.sub2._id,
      deadline: new Date(Date.now() + 6 * 3600000),
      maxMarks: 5,
      createdBy: fx.f2.user,
    });
    const sent = await sendDeadlineReminders();
    expect(sent).toBe(4);
    expect(await Notification.countDocuments({ title: 'Assignment due soon' })).toBe(4);
    expect(await sendDeadlineReminders()).toBe(0); // idempotent
    await Assignment.deleteOne({ _id: a._id });
  });

  test('files require login and unknown paths are safe', async () => {
    const file = assignment.attachment.path;
    expect((await request(app).get(`/api/files/${file}`)).status).toBe(401);
    expect((await request(app).get(`/api/files/${file}`).set(A(stu1))).status).toBe(200);
    expect((await request(app).get('/api/files/assignments/..%2F..%2F.env').set(A(stu1))).status).toBe(404);
    expect((await request(app).get('/api/files/secrets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf').set(A(stu1))).status).toBe(404);
    fs.rmSync(path.join(process.cwd(), 'uploads', 'assignments'), { recursive: true, force: true });
  });
});

describe('notices & notifications', () => {
  test('admin targeted notice reaches only matching students; faculty limited to their sections', async () => {
    const n = await request(app)
      .post('/api/notices')
      .set(A(fx.tokens.admin))
      .send({ title: 'Section B only', description: 'hello', audience: 'students', section: String(fx.otherSection._id) });
    expect(n.status).toBe(201);
    const stu4 = await login(app, 'stu4@t.local');
    expect((await request(app).get('/api/notices').set(A(stu4.accessToken))).body.data.map((x) => x.title)).toContain('Section B only');
    expect((await request(app).get('/api/notices').set(A(stu1))).body.data.map((x) => x.title)).not.toContain('Section B only');
    expect(await Notification.countDocuments({ user: fx.students[3].user, type: 'notice' })).toBe(1);
    expect(await Notification.countDocuments({ user: fx.students[0].user, type: 'notice' })).toBe(0);
    // faculty need a section they teach
    expect((await request(app).post('/api/notices').set(A(fx.tokens.fac1)).send({ title: 'No section', description: 'x' })).status).toBe(
      403
    );
    expect(
      (
        await request(app)
          .post('/api/notices')
          .set(A(fx.tokens.fac1))
          .send({ title: 'Class note', description: 'x', section: String(fx.section._id), audience: 'all' })
      ).status
    ).toBe(201);
    expect((await request(app).post('/api/notices').set(A(stu1)).send({ title: 'x', description: 'y' })).status).toBe(403);
  });

  test('expired and future notices are hidden from students', async () => {
    await request(app)
      .post('/api/notices')
      .set(A(fx.tokens.admin))
      .send({ title: 'Expired one', description: 'x', expiryDate: '2000-01-01' });
    await request(app)
      .post('/api/notices')
      .set(A(fx.tokens.admin))
      .send({ title: 'Future one', description: 'x', publishDate: future(5) });
    const titles = (await request(app).get('/api/notices').set(A(stu1))).body.data.map((x) => x.title);
    expect(titles).not.toContain('Expired one');
    expect(titles).not.toContain('Future one');
  });

  test('notifications: list, unread count, read, read-all — isolated per user', async () => {
    const list = await request(app).get('/api/notifications?unread=true').set(A(stu1));
    expect(list.body.meta.unread).toBeGreaterThan(0);
    const first = list.body.data[0];
    expect((await request(app).patch(`/api/notifications/${first._id}/read`).set(A(fx.tokens.stu2))).status).toBe(404);
    expect((await request(app).patch(`/api/notifications/${first._id}/read`).set(A(stu1))).body.data.isRead).toBe(true);
    await request(app).post('/api/notifications/read-all').set(A(stu1));
    expect((await request(app).get('/api/notifications/unread-count').set(A(stu1))).body.data.count).toBe(0);
    expect((await request(app).get('/api/notifications/unread-count').set(A(fx.tokens.stu2))).body.data.count).toBeGreaterThan(0);
  });
});

describe('documents, complaints, achievements', () => {
  test('document upload, verification and file-level protection', async () => {
    const up = await request(app)
      .post('/api/documents')
      .set(A(stu1))
      .field('title', 'Marksheet')
      .field('type', 'marksheet')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'm.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const d = up.body.data;
    expect((await request(app).get(`/api/files/${d.file.path}`).set(A(stu1))).status).toBe(200);
    expect((await request(app).get(`/api/files/${d.file.path}`).set(A(fx.tokens.stu2))).status).toBe(403);
    expect((await request(app).get(`/api/files/${d.file.path}`).set(A(fx.tokens.fac1))).status).toBe(403);
    expect((await request(app).get(`/api/files/${d.file.path}`).set(A(fx.tokens.admin))).status).toBe(200);
    expect((await request(app).get('/api/documents').set(A(fx.tokens.stu2))).body.data).toHaveLength(0);
    expect((await request(app).patch(`/api/documents/${d._id}/review`).set(A(stu1)).send({ status: 'verified' })).status).toBe(403);
    expect((await request(app).patch(`/api/documents/${d._id}/review`).set(A(fx.tokens.admin)).send({ status: 'rejected' })).status).toBe(
      400
    ); // needs a note
    expect(
      (await request(app).patch(`/api/documents/${d._id}/review`).set(A(fx.tokens.admin)).send({ status: 'verified' })).body.data.status
    ).toBe('verified');
    expect((await request(app).delete(`/api/documents/${d._id}`).set(A(stu1))).status).toBe(409);
    fs.rmSync(path.join(process.cwd(), 'uploads', 'documents'), { recursive: true, force: true });
  });

  test('complaint workflow', async () => {
    const c = await request(app)
      .post('/api/complaints')
      .set(A(stu1))
      .send({ category: 'academic', subject: 'Marks missing', description: 'My quiz marks are missing.' });
    expect(c.status).toBe(201);
    const id = c.body.data._id;
    expect((await request(app).post('/api/complaints').set(A(stu1)).send({ subject: 'x' })).status).toBe(400);
    expect((await request(app).get(`/api/complaints/${id}`).set(A(fx.tokens.stu2))).status).toBe(404);
    expect((await request(app).get('/api/complaints').set(A(fx.tokens.fac1))).body.data).toHaveLength(0); // not assigned
    const fac = await (await import('@/models')).User.findOne({ email: 'fac1@t.local' });
    expect(
      (
        await request(app)
          .patch(`/api/complaints/${id}`)
          .set(A(fx.tokens.fac1))
          .send({ assignedTo: String(fac._id) })
      ).status
    ).toBe(404); // cannot even see unassigned tickets
    const asg = await request(app)
      .patch(`/api/complaints/${id}`)
      .set(A(fx.tokens.admin))
      .send({ assignedTo: String(fac._id) });
    expect(asg.body.data.status).toBe('assigned');
    expect((await request(app).get('/api/complaints').set(A(fx.tokens.fac1))).body.data).toHaveLength(1);
    expect(
      (await request(app).post(`/api/complaints/${id}/respond`).set(A(fx.tokens.fac1)).send({ message: 'Looking into it' })).body.data
        .status
    ).toBe('in_progress');
    expect((await request(app).patch(`/api/complaints/${id}`).set(A(fx.tokens.fac1)).send({ status: 'resolved' })).body.data.status).toBe(
      'resolved'
    );
    expect((await request(app).patch(`/api/complaints/${id}`).set(A(stu1)).send({ status: 'open' })).status).toBe(403);
    expect((await request(app).patch(`/api/complaints/${id}`).set(A(stu1)).send({ status: 'closed' })).body.data.status).toBe('closed');
  });

  test('achievements require verification by staff', async () => {
    const a = await request(app).post('/api/achievements').set(A(stu1)).send({ title: 'Hackathon winner', category: 'hackathon' });
    expect(a.status).toBe(201);
    expect(a.body.data.status).toBe('pending');
    expect((await request(app).patch(`/api/achievements/${a.body.data._id}/verify`).set(A(stu1)).send({ status: 'verified' })).status).toBe(
      403
    );
    expect(
      (await request(app).patch(`/api/achievements/${a.body.data._id}/verify`).set(A(fx.tokens.fac1)).send({ status: 'verified' })).body
        .data.status
    ).toBe('verified');
  });
});

describe('bulk import', () => {
  const csv = (rows) =>
    [
      'studentId,firstName,lastName,email,phone,gender,dateOfBirth,departmentCode,programCode,semester,batch,section,admissionYear,guardianName,guardianPhone',
      ...rows,
    ].join('\n');

  test('preview reports row errors; confirm inserts only valid rows', async () => {
    const good = 'S700,Ana,Lee,ana@t.local,9876543210,female,2006-01-01,CSE,BTCSE,2,2025,A,2025,G Lee,9000000000';
    const bad = [
      'S701,Bob,Ray,not-an-email,,,,CSE,BTCSE,2,2025,A,2025,,',
      'S1,Dup,Id,dup@t.local,,,,CSE,BTCSE,2,2025,A,2025,,',
      'S702,No,Dept,nd@t.local,,,,XXX,BTCSE,2,2025,A,2025,,',
      'S700,Twice,InFile,twice@t.local,,,,CSE,BTCSE,2,2025,A,2025,,',
    ];
    const prev = await request(app)
      .post('/api/import/students/preview')
      .set(A(fx.tokens.admin))
      .attach('file', Buffer.from(csv([good, ...bad])), { filename: 's.csv', contentType: 'text/csv' });
    expect(prev.status).toBe(200);
    expect(prev.body.data).toMatchObject({ total: 5, validCount: 1, invalidCount: 4 });
    expect(prev.body.data.rows[1].errors.join()).toMatch(/email/);
    expect(prev.body.data.rows[2].errors.join()).toMatch(/already exists/);
    expect(prev.body.data.rows[3].errors.join()).toMatch(/departmentCode/);
    expect(prev.body.data.rows[4].errors.join()).toMatch(/in this file/);
    expect(await Student.countDocuments({ studentId: 'S700' })).toBe(0); // preview writes nothing
    const conf = await request(app)
      .post('/api/import/students/confirm')
      .set(A(fx.tokens.admin))
      .send({ importId: prev.body.data.importId });
    expect(conf.status).toBe(201);
    expect(conf.body.data.created).toHaveLength(1);
    expect(conf.body.data.created[0].temporaryPassword).toBeTruthy();
    expect(await Student.countDocuments({ studentId: 'S700' })).toBe(1);
    expect(
      (await request(app).post('/api/import/students/confirm').set(A(fx.tokens.admin)).send({ importId: prev.body.data.importId })).status
    ).toBe(400); // single use
  });

  test('rejects wrong columns and non-CSV files', async () => {
    const miss = await request(app)
      .post('/api/import/students/preview')
      .set(A(fx.tokens.admin))
      .attach('file', Buffer.from('a,b\n1,2'), { filename: 's.csv', contentType: 'text/csv' });
    expect(miss.status).toBe(400);
    const wrong = await request(app)
      .post('/api/import/students/preview')
      .set(A(fx.tokens.admin))
      .attach('file', Buffer.from('x'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(wrong.status).toBe(400);
  });
});

describe('fees, library, placements, reports, dashboards', () => {
  test('fees: assign, simulated payment, overpay blocked, ownership', async () => {
    const st = await request(app)
      .post('/api/fees/structures')
      .set(A(fx.tokens.admin))
      .send({ name: 'Tuition', program: String(fx.program._id), semester: 2, amount: 1000, dueDate: future(10) });
    expect(st.status).toBe(201);
    const asg = await request(app).post(`/api/fees/structures/${st.body.data._id}/assign`).set(A(fx.tokens.admin));
    expect(asg.body.data.created).toBe(5); // 4 fixture + 1 imported student
    const fees = await request(app).get('/api/fees').set(A(stu1));
    expect(fees.body.data).toHaveLength(1);
    const id = fees.body.data[0]._id;
    expect((await request(app).post(`/api/fees/${id}/pay`).set(A(stu1)).send({ amount: 2000 })).status).toBe(400);
    const pay = await request(app).post(`/api/fees/${id}/pay`).set(A(stu1)).send({ amount: 400 });
    expect(pay.body.data.receiptNo).toMatch(/^RCT-/);
    expect((await request(app).get('/api/fees').set(A(stu1))).body.data[0]).toMatchObject({ amountPending: 600, status: 'partial' });
    const other = (await request(app).get('/api/fees').set(A(fx.tokens.admin))).body.data.find(
      (f) => String(f.student._id) !== String(fx.students[0]._id)
    );
    expect((await request(app).post(`/api/fees/${other._id}/pay`).set(A(stu1)).send({ amount: 10 })).status).toBe(404);
    expect((await request(app).get(`/api/fees/${id}/receipt/${pay.body.data.receiptNo}`).set(A(stu1))).status).toBe(200);
    expect((await request(app).get('/api/fees?status=partial').set(A(fx.tokens.admin))).body.data).toHaveLength(1);
  });

  test('library: issue decrements copies atomically, blocks when none left, fine on late return', async () => {
    const book = await request(app)
      .post('/api/library/books')
      .set(A(fx.tokens.admin))
      .send({ title: 'Algorithms', authors: ['CLRS'], isbn: '9780262033848', totalCopies: 1 });
    expect(book.status).toBe(201);
    const issue = await request(app)
      .post('/api/library/issue')
      .set(A(fx.tokens.admin))
      .send({ book: book.body.data._id, student: String(fx.students[0]._id) });
    expect(issue.status).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/library/issue')
          .set(A(fx.tokens.admin))
          .send({ book: book.body.data._id, student: String(fx.students[1]._id) })
      ).status
    ).toBe(409);
    expect((await Book.findById(book.body.data._id)).availableCopies).toBe(0);
    const { BookIssue } = await import('@/models');
    await BookIssue.updateOne({ _id: issue.body.data._id }, { dueDate: new Date(Date.now() - 2.5 * 86400000) });
    const ret = await request(app).post(`/api/library/return/${issue.body.data._id}`).set(A(fx.tokens.admin));
    expect(ret.body.data.fine).toBe(6); // 3 started days × default 2
    expect((await Book.findById(book.body.data._id)).availableCopies).toBe(1);
    expect(
      (
        await request(app)
          .post('/api/library/issue')
          .set(A(stu1))
          .send({ book: book.body.data._id, student: String(fx.students[0]._id) })
      ).status
    ).toBe(403);
    expect(
      (await request(app).post('/api/library/books').set(A(fx.tokens.admin)).send({ title: 'x', authors: [], isbn: '1', totalCopies: 1 }))
        .status
    ).toBe(400);
  });

  test('placements: eligibility enforced, application tracked', async () => {
    const co = await request(app).post('/api/placements/companies').set(A(fx.tokens.admin)).send({ name: 'Acme' });
    const job = await request(app)
      .post('/api/placements/jobs')
      .set(A(fx.tokens.admin))
      .send({ company: co.body.data._id, title: 'SDE', deadline: future(10), isPublished: true, eligibility: { minCgpa: 9.5 } });
    expect(job.status).toBe(201);
    const list = await request(app).get('/api/placements/jobs').set(A(stu1));
    expect(list.body.data[0].eligible).toBe(false);
    expect((await request(app).post(`/api/placements/jobs/${job.body.data._id}/apply`).set(A(stu1))).status).toBe(400);
    await request(app)
      .patch(`/api/placements/jobs/${job.body.data._id}`)
      .set(A(fx.tokens.admin))
      .send({ eligibility: { minCgpa: 0 } });
    const apply = await request(app).post(`/api/placements/jobs/${job.body.data._id}/apply`).set(A(stu1));
    expect(apply.status).toBe(201);
    expect((await request(app).post(`/api/placements/jobs/${job.body.data._id}/apply`).set(A(stu1))).status).toBe(409);
    const st = await request(app)
      .patch(`/api/placements/applications/${apply.body.data._id}/status`)
      .set(A(fx.tokens.admin))
      .send({ status: 'shortlisted' });
    expect(st.body.data.history).toHaveLength(2);
    expect((await request(app).get('/api/placements/applications').set(A(stu1))).body.data[0].status).toBe('shortlisted');
    expect((await request(app).post('/api/placements/jobs').set(A(stu1)).send({})).status).toBe(403);
  });

  test('reports: json, csv (formula-safe), pdf; faculty restricted', async () => {
    const json = await request(app).get('/api/reports/students?limit=2').set(A(fx.tokens.admin));
    expect(json.body.data.rows).toHaveLength(2);
    expect(json.body.meta.total).toBe(5);
    const csv = await request(app).get('/api/reports/students?format=csv').set(A(fx.tokens.admin));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Student ID/);
    const pdf = await request(app)
      .get('/api/reports/students?format=pdf')
      .set(A(fx.tokens.admin))
      .buffer()
      .parse((res, cb) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await request(app).get('/api/reports/students').set(A(fx.tokens.fac1))).status).toBe(403);
    expect((await request(app).get('/api/reports/attendance').set(A(fx.tokens.fac1))).status).toBe(200);
    expect((await request(app).get(`/api/reports/attendance?subject=${fx.sub2._id}`).set(A(fx.tokens.fac1))).status).toBe(403);
    expect((await request(app).get('/api/reports/marks').set(A(fx.tokens.fac1))).status).toBe(200);
    for (const t of ['faculty', 'results', 'fees', 'placements', 'complaints'])
      expect((await request(app).get(`/api/reports/${t}`).set(A(fx.tokens.admin))).status).toBe(200);
    expect((await request(app).get('/api/reports/bogus').set(A(fx.tokens.admin))).status).toBe(404);
    expect((await request(app).get('/api/reports/students').set(A(stu1))).status).toBe(403);
  });

  test('dashboards return data for each role', async () => {
    const admin = await request(app).get('/api/dashboard/admin').set(A(fx.tokens.admin));
    expect(admin.status).toBe(200);
    expect(admin.body.data.counts.totalStudents).toBe(5);
    expect((await request(app).get('/api/dashboard/faculty').set(A(fx.tokens.fac1))).status).toBe(200);
    const s = await request(app).get('/api/dashboard/student').set(A(stu1));
    expect(s.status).toBe(200);
    expect(s.body.data.student.studentId).toBe('S1');
    expect((await request(app).get('/api/dashboard/student').set(A(fx.tokens.parent))).body.data.student.studentId).toBe('S1');
    expect((await request(app).get('/api/dashboard/admin').set(A(fx.tokens.fac1))).status).toBe(403);
  });

  test('audit trail captured key actions', async () => {
    const actions = await AuditLog.distinct('action');
    expect(actions).toEqual(expect.arrayContaining(['LOGIN', 'ASSIGNMENT_CREATED', 'NOTICE_CREATED', 'DOCUMENT_VERIFIED', 'FEE_PAYMENT']));
    void Subject;
  });
});
