import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import * as M from '../src/models/index.js';
import { syncEnrollments } from '../src/services/enrollment.js';

export const PASSWORD = 'Test@12345';
let memory;

/** Connect to the local test database; fall back to an in-memory MongoDB if none is running. */
export async function setupDb() {
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 2500 });
  } catch {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri('sms_test'));
  }
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
  return createApp();
}

export async function teardownDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (memory) await memory.stop();
}

export async function login(app, email, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body?.data;
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Minimal college: 1 dept/program/section, 2 subjects, admin, 2 faculty, 3 students (+1 in another section). */
export async function makeFixtures(app) {
  const dept = await M.Department.create({ name: 'Computer Science', code: 'CSE' });
  const program = await M.Program.create({ name: 'B.Tech CSE', code: 'BTCSE', department: dept._id });
  const section = await M.Section.create({ name: 'A', program: program._id, department: dept._id, batch: '2025', semester: 2 });
  const otherSection = await M.Section.create({ name: 'B', program: program._id, department: dept._id, batch: '2025', semester: 2 });

  const mkFaculty = async (n) => {
    const user = await M.User.create({ name: `Fac ${n}`, email: `fac${n}@t.local`, password: PASSWORD, role: 'faculty' });
    return M.Faculty.create({
      user: user._id,
      employeeId: `F${n}`,
      firstName: 'Fac',
      lastName: String(n),
      email: `fac${n}@t.local`,
      department: dept._id,
    });
  };
  const f1 = await mkFaculty(1);
  const f2 = await mkFaculty(2);
  await M.User.create({ name: 'Admin', email: 'admin@t.local', password: PASSWORD, role: 'admin' });

  const sub1 = await M.Subject.create({
    code: 'CS101',
    name: 'Algorithms',
    department: dept._id,
    program: program._id,
    semester: 2,
    credits: 4,
    faculty: f1._id,
  });
  const sub2 = await M.Subject.create({
    code: 'CS102',
    name: 'Databases',
    department: dept._id,
    program: program._id,
    semester: 2,
    credits: 3,
    faculty: f2._id,
  });

  const students = [];
  for (let n = 1; n <= 4; n++) {
    const user = await M.User.create({ name: `Stu ${n}`, email: `stu${n}@t.local`, password: PASSWORD, role: 'student' });
    const s = await M.Student.create({
      user: user._id,
      studentId: `S${n}`,
      firstName: 'Stu',
      lastName: String(n),
      email: `stu${n}@t.local`,
      department: dept._id,
      program: program._id,
      semester: 2,
      section: n === 4 ? otherSection._id : section._id,
      batch: '2025',
    });
    await syncEnrollments(s);
    students.push(s);
  }
  const parent = await M.User.create({
    name: 'Parent',
    email: 'parent@t.local',
    password: PASSWORD,
    role: 'parent',
    children: [students[0]._id],
  });

  const tokens = {
    admin: (await login(app, 'admin@t.local')).accessToken,
    fac1: (await login(app, 'fac1@t.local')).accessToken,
    fac2: (await login(app, 'fac2@t.local')).accessToken,
    stu1: (await login(app, 'stu1@t.local')).accessToken,
    stu2: (await login(app, 'stu2@t.local')).accessToken,
    parent: (await login(app, 'parent@t.local')).accessToken,
  };
  return { dept, program, section, otherSection, f1, f2, sub1, sub2, students, parent, tokens };
}
