/**
 * Development seed data.  Usage:  npm run seed          (adds demo data if the DB is empty)
 *                                  npm run seed -- --reset (wipes ALL collections first)
 * Refuses to run when NODE_ENV=production.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import * as M from './models/index.js';
import { syncEnrollments } from './services/enrollment.js';

const PASSWORD = env.seedPassword;
const day = (offset) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offset));

export async function seed({ reset = false, log = console.log } = {}) {
  if (env.isProd) throw new Error('Refusing to seed in production');
  if (reset) {
    await Promise.all(Object.values(mongoose.connection.models).map((m) => m.deleteMany({})));
    log('Database cleared');
  } else if (await M.User.exists({})) {
    log('Database already has users. Use `npm run seed -- --reset` to wipe and reseed.');
    return null;
  }

  await M.Settings.create({ key: 'main', collegeName: 'Demo Institute of Technology', contact: { email: 'office@demo.edu', phone: '+91 40 5555 0100', address: '1 College Road, Hyderabad', website: 'https://demo.edu' } });

  // --- structure
  const [cse, ece, mech] = await M.Department.create([
    { name: 'Computer Science & Engineering', code: 'CSE' },
    { name: 'Electronics & Communication', code: 'ECE' },
    { name: 'Mechanical Engineering', code: 'MECH' },
  ]);
  const [pCse, pEce, pMech] = await M.Program.create([
    { name: 'B.Tech Computer Science', code: 'BTECH-CSE', department: cse._id, durationYears: 4, totalSemesters: 8 },
    { name: 'B.Tech Electronics', code: 'BTECH-ECE', department: ece._id, durationYears: 4, totalSemesters: 8 },
    { name: 'B.Tech Mechanical', code: 'BTECH-MECH', department: mech._id, durationYears: 4, totalSemesters: 8 },
  ]);
  const year = await M.AcademicYear.create({ name: '2025-26', startDate: new Date('2025-06-15'), endDate: new Date('2026-05-31'), isCurrent: true });
  await M.Semester.create([
    { name: 'Odd Semester', number: 1, academicYear: year._id, startDate: new Date('2025-06-15'), endDate: new Date('2025-11-30'), isCurrent: false },
    { name: 'Even Semester', number: 2, academicYear: year._id, startDate: new Date('2025-12-15'), endDate: new Date('2026-05-31'), isCurrent: true },
  ]);
  const sections = await M.Section.create([
    { name: 'A', program: pCse._id, department: cse._id, batch: '2025', semester: 2, capacity: 60 },
    { name: 'B', program: pCse._id, department: cse._id, batch: '2025', semester: 2, capacity: 60 },
    { name: 'A', program: pEce._id, department: ece._id, batch: '2025', semester: 2, capacity: 60 },
    { name: 'A', program: pMech._id, department: mech._id, batch: '2025', semester: 2, capacity: 60 },
  ]);
  const [secCseA, secCseB, secEceA, secMechA] = sections;

  // --- users
  await M.User.create({ name: 'System Admin', email: 'admin@college.local', password: PASSWORD, role: 'admin' });

  const facultyDefs = [
    ['FAC001', 'Meera', 'Iyer', 'meera.iyer', cse, 'Professor'],
    ['FAC002', 'Arjun', 'Nair', 'arjun.nair', cse, 'Associate Professor'],
    ['FAC003', 'Kavita', 'Sharma', 'kavita.sharma', ece, 'Assistant Professor'],
    ['FAC004', 'Rahul', 'Verma', 'rahul.verma', mech, 'Professor'],
    ['FAC005', 'Sana', 'Khan', 'sana.khan', cse, 'Assistant Professor'],
  ];
  const faculty = [];
  for (const [employeeId, firstName, lastName, local, department, designation] of facultyDefs) {
    const email = `${local}@college.local`;
    const user = await M.User.create({ name: `${firstName} ${lastName}`, email, password: PASSWORD, role: 'faculty' });
    faculty.push(await M.Faculty.create({ user: user._id, employeeId, firstName, lastName, email, phone: '9876500000', department: department._id, designation, joiningDate: new Date('2018-07-01') }));
  }
  const [fMeera, fArjun, fKavita, fRahul, fSana] = faculty;

  // --- subjects (semester 2)
  const subjects = await M.Subject.create([
    { code: 'CS201', name: 'Data Structures', department: cse._id, program: pCse._id, semester: 2, credits: 4, type: 'theory', faculty: fMeera._id },
    { code: 'CS202', name: 'Database Systems', department: cse._id, program: pCse._id, semester: 2, credits: 3, type: 'theory', faculty: fArjun._id },
    { code: 'CS203', name: 'Data Structures Lab', department: cse._id, program: pCse._id, semester: 2, credits: 2, type: 'practical', faculty: fSana._id },
    { code: 'CS204', name: 'Discrete Mathematics', department: cse._id, program: pCse._id, semester: 2, credits: 3, type: 'theory', faculty: fMeera._id },
    { code: 'EC201', name: 'Signals and Systems', department: ece._id, program: pEce._id, semester: 2, credits: 4, type: 'theory', faculty: fKavita._id },
    { code: 'EC202', name: 'Analog Circuits', department: ece._id, program: pEce._id, semester: 2, credits: 3, type: 'theory', faculty: fKavita._id },
    { code: 'ME201', name: 'Thermodynamics', department: mech._id, program: pMech._id, semester: 2, credits: 4, type: 'theory', faculty: fRahul._id },
  ]);
  const byCode = Object.fromEntries(subjects.map((s) => [s.code, s]));

  // --- students
  const firsts = ['Aarav', 'Diya', 'Vihaan', 'Anaya', 'Ishaan', 'Saanvi', 'Kabir', 'Myra', 'Reyansh', 'Aditi', 'Arnav', 'Kiara', 'Dhruv', 'Riya', 'Vivaan', 'Navya', 'Yash', 'Tara', 'Rohan', 'Pooja', 'Karan', 'Neha', 'Sahil', 'Ira', 'Manav', 'Zoya', 'Nikhil', 'Sneha', 'Om', 'Lavanya'];
  const lasts = ['Reddy', 'Patel', 'Singh', 'Gupta', 'Das', 'Mehta', 'Joshi', 'Menon', 'Bose', 'Kulkarni'];
  const placement = [
    { dept: cse, prog: pCse, sec: secCseA, n: 10 },
    { dept: cse, prog: pCse, sec: secCseB, n: 8 },
    { dept: ece, prog: pEce, sec: secEceA, n: 7 },
    { dept: mech, prog: pMech, sec: secMechA, n: 5 },
  ];
  const students = [];
  let i = 0;
  for (const g of placement) {
    for (let k = 0; k < g.n; k++, i++) {
      const firstName = firsts[i % firsts.length];
      const lastName = lasts[(i * 3) % lasts.length];
      const studentId = `S25${String(i + 1).padStart(4, '0')}`;
      const email = `${studentId.toLowerCase()}@college.local`;
      const user = await M.User.create({ name: `${firstName} ${lastName}`, email, password: PASSWORD, role: 'student' });
      const s = await M.Student.create({
        user: user._id, studentId, firstName, lastName, email, phone: `98765${String(10000 + i).slice(-5)}`, gender: i % 2 ? 'female' : 'male', dateOfBirth: new Date(`2006-0${(i % 9) + 1}-1${i % 9}`),
        department: g.dept._id, program: g.prog._id, batch: '2025', academicYear: year._id, semester: 2, section: g.sec._id, admissionYear: 2025, admissionDate: new Date('2025-06-20'),
        guardian: { name: `${lastName} Sr.`, relation: 'Father', phone: '9000000000' }, address: { city: 'Hyderabad', state: 'Telangana', country: 'India' },
      });
      await syncEnrollments(s);
      students.push(s);
    }
  }
  // one parent linked to first two students
  await M.User.create({ name: 'Parent Demo', email: 'parent@college.local', password: PASSWORD, role: 'parent', children: [students[0]._id] });

  // --- attendance (last 20 weekdays) & marks
  const enrollments = await M.Enrollment.find().lean();
  const bySubject = new Map();
  for (const e of enrollments) {
    const k = String(e.subject);
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k).push(String(e.student));
  }
  const studentMap = new Map(students.map((s) => [String(s._id), s]));
  const rand = (seed0) => { let x = seed0; return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296); };
  const rnd = rand(42);
  const attendanceDocs = [];
  const marksDocs = [];
  for (const subject of subjects) {
    const ids = bySubject.get(String(subject._id)) || [];
    const fac = faculty.find((f) => String(f._id) === String(subject.faculty));
    const days = [];
    for (let d = -1; days.length < 20; d--) {
      const dt = day(d);
      if (![0, 6].includes(dt.getUTCDay())) days.push(dt);
    }
    for (const sid of ids) {
      const stu = studentMap.get(sid);
      const quality = 0.55 + rnd() * 0.45; // per-student attendance propensity
      for (const dt of days) {
        const r = rnd();
        attendanceDocs.push({ subject: subject._id, section: stu.section, student: stu._id, date: dt, status: r < quality ? 'present' : r < quality + 0.03 ? 'late' : 'absent', markedBy: fac.user });
      }
      const ability = 0.45 + rnd() * 0.5;
      for (const [examType, max] of [['quiz', 10], ['internal', 20], ['mid', 30]]) {
        marksDocs.push({ student: stu._id, subject: subject._id, semester: 2, examType, maxMarks: max, marksObtained: Math.round(max * Math.min(1, ability + (rnd() - 0.5) * 0.25) * 10) / 10, enteredBy: fac.user });
      }
    }
  }
  await M.Attendance.insertMany(attendanceDocs);
  await M.Mark.insertMany(marksDocs);

  // --- assignments, exams, timetable, notices, calendar
  const cseA = secCseA._id;
  await M.Assignment.create([
    { title: 'Linked list implementation', description: 'Implement singly and doubly linked lists in C/C++ with insert, delete and reverse.', subject: byCode.CS201._id, sections: [], deadline: day(7), maxMarks: 20, createdBy: fMeera.user },
    { title: 'ER diagram for a library', description: 'Design an ER model and convert it to relational schema.', subject: byCode.CS202._id, sections: [], deadline: day(4), maxMarks: 15, createdBy: fArjun.user },
  ]);
  await M.Exam.create([
    { name: 'Mid Semester - Data Structures', type: 'mid', subject: byCode.CS201._id, program: pCse._id, semester: 2, date: day(14), startTime: '10:00', endTime: '12:00', room: 'Hall A', invigilators: [fArjun._id], maxMarks: 30, isPublished: true },
    { name: 'Mid Semester - Database Systems', type: 'mid', subject: byCode.CS202._id, program: pCse._id, semester: 2, date: day(15), startTime: '10:00', endTime: '12:00', room: 'Hall A', invigilators: [fMeera._id], maxMarks: 30, isPublished: true },
  ]);
  const slots = [
    ['monday', '09:00', '10:00', 'CS201', fMeera, 'R101', cseA], ['monday', '10:00', '11:00', 'CS202', fArjun, 'R101', cseA],
    ['tuesday', '09:00', '10:00', 'CS204', fMeera, 'R101', cseA], ['tuesday', '11:00', '13:00', 'CS203', fSana, 'LAB1', cseA],
    ['wednesday', '09:00', '10:00', 'CS201', fMeera, 'R101', cseA], ['thursday', '10:00', '11:00', 'CS202', fArjun, 'R101', cseA],
    ['friday', '09:00', '10:00', 'CS204', fMeera, 'R101', cseA],
  ];
  await M.Timetable.create(slots.map(([d, s, e, code, f, room, sec]) => ({ day: d, startTime: s, endTime: e, subject: byCode[code]._id, faculty: f._id, room, section: sec })));
  const admin = await M.User.findOne({ role: 'admin' });
  await M.Notice.create([
    { title: 'Welcome to the new semester', description: 'Classes for the even semester begin this week. Please check your timetable.', audience: 'all', priority: 'normal', createdBy: admin._id },
    { title: 'Mid-semester exam schedule published', description: 'The exam schedule is available under Examinations. Report to the hall 15 minutes early.', audience: 'students', priority: 'high', createdBy: admin._id },
    { title: 'Faculty meeting on Friday', description: 'All faculty are requested to attend the academic council meeting at 4 PM.', audience: 'faculty', priority: 'normal', createdBy: admin._id },
  ]);
  await M.CalendarEvent.create([
    { title: 'Mid semester examinations', type: 'exam', startDate: day(14), endDate: day(20), audience: 'all', createdBy: admin._id },
    { title: 'Tech fest', type: 'event', startDate: day(30), audience: 'all', createdBy: admin._id },
    { title: 'Public holiday', type: 'holiday', startDate: day(10), audience: 'all', createdBy: admin._id },
  ]);

  // --- fees, placements, library
  const fs = await M.FeeStructure.create({ name: 'Semester 2 Tuition', program: pCse._id, semester: 2, amount: 45000, dueDate: day(20) });
  const cseStudents = students.filter((s) => String(s.program) === String(pCse._id));
  await M.Fee.insertMany(cseStudents.map((s, idx) => ({ student: s._id, structure: fs._id, title: fs.name, amountDue: fs.amount, amountPaid: idx % 3 === 0 ? fs.amount : 0, dueDate: fs.dueDate, payments: idx % 3 === 0 ? [{ amount: fs.amount, method: 'cash', receiptNo: `RCT-SEED-${idx}` }] : [] })));
  const co = await M.Company.create([{ name: 'Acme Software', industry: 'IT Services', website: 'https://acme.example' }, { name: 'Globex Systems', industry: 'Product' }]);
  await M.Job.create([
    { company: co[0]._id, title: 'Software Engineer Trainee', description: 'Full-stack development.', location: 'Hyderabad', package: 600000, eligibility: { minCgpa: 6, programs: [pCse._id], maxActiveBacklogs: 0 }, deadline: day(25), isPublished: true },
    { company: co[1]._id, title: 'Graduate Engineer', location: 'Bengaluru', package: 800000, eligibility: { minCgpa: 7.5, programs: [] }, deadline: day(35), isPublished: true },
  ]);
  await M.Book.create([
    { title: 'Introduction to Algorithms', authors: ['Cormen', 'Leiserson', 'Rivest', 'Stein'], isbn: '9780262033848', category: 'Computer Science', totalCopies: 5, availableCopies: 5 },
    { title: 'Database System Concepts', authors: ['Silberschatz', 'Korth', 'Sudarshan'], isbn: '9780078022159', category: 'Computer Science', totalCopies: 3, availableCopies: 3 },
    { title: 'Engineering Thermodynamics', authors: ['P. K. Nag'], isbn: '9780070151314', category: 'Mechanical', totalCopies: 2, availableCopies: 2 },
  ]);

  log(`Seeded: ${students.length} students, ${faculty.length} faculty, ${subjects.length} subjects, ${attendanceDocs.length} attendance rows, ${marksDocs.length} marks.`);
  return { students: students.length };
}

// CLI entry
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  (async () => {
    try {
      await connectDB();
      const res = await seed({ reset: process.argv.includes('--reset') });
      if (res) {
        console.log('\nDevelopment credentials (password from SEED_PASSWORD in .env, default shown in .env.example):');
        console.log('  Admin   : admin@college.local');
        console.log('  Faculty : meera.iyer@college.local (also arjun.nair, kavita.sharma, rahul.verma, sana.khan)');
        console.log('  Student : s250001@college.local (S250001 … S250030)');
        console.log('  Parent  : parent@college.local');
      }
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    } finally {
      await disconnectDB();
    }
  })();
}
