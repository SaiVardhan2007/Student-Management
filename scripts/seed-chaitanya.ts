/**
 * Realistic SAMPLE data for "Chaitanya (Deemed to be University)", Hyderabad: departments, faculty, students (with
 * logins), parents, subjects, timetable, attendance, marks, assignments, exams, notices, fees, placements, library...
 *
 *   MONGODB_URI='<uri>' npx tsx scripts/seed-chaitanya.ts --yes
 *
 * DESTRUCTIVE: deletes ALL data except admin accounts, then re-creates the sample data. All names, emails ending in
 * @example.com, phone numbers and records are fictional. Temporary passwords are written to backups/sample-credentials.csv.
 */
import fs from 'fs';
import mongoose from 'mongoose';
import './env';
import { connectDB, disconnectDB } from '../lib/mongodb';
import * as M from '../models';
import { createAccount } from '../services/accounts';
import { syncEnrollments } from '../services/enrollment';

const day = (offset: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offset));
let seedN = 7;
const rnd = () => (seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const creds: string[][] = [['role', 'name', 'email', 'id', 'temporary_password']];

async function account(name: string, email: string, role: string, id = '') {
  const { user, temporaryPassword } = await createAccount({ name, email, role });
  creds.push([role, name, email, id, temporaryPassword || '']);
  return user;
}

const DEPTS = [
  { code: 'CSE', name: 'Computer Science and Engineering', prog: ['BTECH-CSE', 'B.Tech Computer Science and Engineering', 4, 8] },
  { code: 'AIML', name: 'Artificial Intelligence and Machine Learning', prog: ['BTECH-AIML', 'B.Tech CSE (Artificial Intelligence and Machine Learning)', 4, 8] },
  { code: 'ECE', name: 'Electronics and Communication Engineering', prog: ['BTECH-ECE', 'B.Tech Electronics and Communication Engineering', 4, 8] },
  { code: 'EEE', name: 'Electrical and Electronics Engineering', prog: ['BTECH-EEE', 'B.Tech Electrical and Electronics Engineering', 4, 8] },
  { code: 'MECH', name: 'Mechanical Engineering', prog: ['BTECH-ME', 'B.Tech Mechanical Engineering', 4, 8] },
  { code: 'CIVIL', name: 'Civil Engineering', prog: ['BTECH-CE', 'B.Tech Civil Engineering', 4, 8] },
  { code: 'MBA', name: 'School of Management Studies', prog: ['MBA', 'Master of Business Administration', 2, 4] },
] as const;

// [employeeId, first, last, dept, designation]
const FACULTY: [string, string, string, string, string][] = [
  ['CDU-F001', 'Srinivas', 'Rao', 'CSE', 'Professor'],
  ['CDU-F002', 'Lakshmi', 'Prasanna', 'CSE', 'Associate Professor'],
  ['CDU-F003', 'Ravi', 'Teja', 'CSE', 'Assistant Professor'],
  ['CDU-F004', 'Madhavi', 'Latha', 'CSE', 'Assistant Professor'],
  ['CDU-F005', 'Venkata', 'Ramana', 'AIML', 'Professor'],
  ['CDU-F006', 'Swathi', 'Reddy', 'AIML', 'Associate Professor'],
  ['CDU-F007', 'Anil', 'Kumar', 'AIML', 'Assistant Professor'],
  ['CDU-F008', 'Sirisha', 'Devi', 'ECE', 'Associate Professor'],
  ['CDU-F009', 'Harsha', 'Vardhan', 'ECE', 'Assistant Professor'],
  ['CDU-F010', 'Padmaja', 'Naidu', 'EEE', 'Professor'],
  ['CDU-F011', 'Kiran', 'Kumar', 'EEE', 'Assistant Professor'],
  ['CDU-F012', 'Sunitha', 'Rani', 'MECH', 'Associate Professor'],
  ['CDU-F013', 'Mohammed', 'Irfan', 'MECH', 'Assistant Professor'],
  ['CDU-F014', 'Deepthi', 'Sharma', 'CIVIL', 'Associate Professor'],
  ['CDU-F015', 'Naveen', 'Chowdary', 'CIVIL', 'Assistant Professor'],
  ['CDU-F016', 'Aruna', 'Kumari', 'MBA', 'Professor'],
  ['CDU-F017', 'Suresh', 'Babu', 'MBA', 'Assistant Professor'],
];

// code, name, credits, type, facultyIndex (into FACULTY)
const SUBJECTS: Record<string, [string, string, number, string, number][]> = {
  CSE: [['CS501', 'Operating Systems', 4, 'theory', 0], ['CS502', 'Database Management Systems', 4, 'theory', 1], ['CS503', 'Computer Networks', 3, 'theory', 2], ['CS504', 'Design and Analysis of Algorithms', 4, 'theory', 3], ['CS505', 'Formal Languages and Automata Theory', 3, 'theory', 0], ['CS506', 'DBMS Laboratory', 2, 'practical', 1]],
  AIML: [['AI501', 'Machine Learning', 4, 'theory', 4], ['AI502', 'Deep Learning', 4, 'theory', 5], ['AI503', 'Natural Language Processing', 3, 'theory', 6], ['AI504', 'Data Mining', 3, 'theory', 4], ['AI505', 'Machine Learning Laboratory', 2, 'practical', 5]],
  ECE: [['EC501', 'Digital Signal Processing', 4, 'theory', 7], ['EC502', 'Microprocessors and Microcontrollers', 4, 'theory', 8], ['EC503', 'VLSI Design', 3, 'theory', 7], ['EC504', 'Digital Communications', 3, 'theory', 8], ['EC505', 'DSP Laboratory', 2, 'practical', 7]],
  EEE: [['EE501', 'Power Systems I', 4, 'theory', 9], ['EE502', 'Control Systems', 4, 'theory', 10], ['EE503', 'Electrical Machines II', 4, 'theory', 9], ['EE504', 'Power Electronics', 3, 'theory', 10], ['EE505', 'Electrical Machines Laboratory', 2, 'practical', 9]],
  MECH: [['ME501', 'Heat Transfer', 4, 'theory', 11], ['ME502', 'Design of Machine Elements', 4, 'theory', 12], ['ME503', 'Dynamics of Machinery', 3, 'theory', 11], ['ME504', 'Manufacturing Technology', 3, 'theory', 12], ['ME505', 'Thermal Engineering Laboratory', 2, 'practical', 11]],
  CIVIL: [['CE501', 'Structural Analysis', 4, 'theory', 13], ['CE502', 'Geotechnical Engineering', 4, 'theory', 14], ['CE503', 'Hydrology and Water Resources', 3, 'theory', 13], ['CE504', 'Transportation Engineering', 3, 'theory', 14], ['CE505', 'Concrete Technology Laboratory', 2, 'practical', 13]],
  MBA: [['MB301', 'Strategic Management', 4, 'theory', 15], ['MB302', 'Financial Management', 4, 'theory', 16], ['MB303', 'Marketing Analytics', 3, 'theory', 15], ['MB304', 'Human Resource Management', 3, 'theory', 16]],
};

const MALE = ['Aditya', 'Rohith', 'Karthik', 'Pranav', 'Sandeep', 'Varun', 'Manoj', 'Akhil', 'Teja', 'Charan', 'Srikanth', 'Naveen', 'Vamsi', 'Abhishek', 'Harish', 'Sathwik', 'Rakesh', 'Dinesh', 'Mahesh', 'Bharath', 'Lokesh', 'Yashwanth', 'Hemanth', 'Ganesh', 'Santosh', 'Uday', 'Pavan', 'Sriram', 'Nikhil', 'Rahul'];
const FEMALE = ['Ananya', 'Sravani', 'Keerthi', 'Divya', 'Bhavana', 'Harini', 'Mounika', 'Pravallika', 'Nikitha', 'Sahithi', 'Meghana', 'Spandana', 'Tejaswini', 'Anusha', 'Lasya', 'Sowmya', 'Pooja', 'Navya', 'Deekshitha', 'Rishitha', 'Jyothi', 'Gayathri', 'Srija', 'Manasa', 'Charitha', 'Ramya', 'Supriya', 'Swetha', 'Aishwarya', 'Bindu'];
const LAST = ['Reddy', 'Naidu', 'Goud', 'Rao', 'Varma', 'Chary', 'Yadav', 'Sharma', 'Kumar', 'Prasad', 'Raju', 'Setty', 'Patel', 'Gupta', 'Mudiraj', 'Bhaskar', 'Nair', 'Joshi'];
const AREAS: [string, string][] = [['Gachibowli', '500032'], ['Kukatpally', '500072'], ['Madhapur', '500081'], ['LB Nagar', '500074'], ['Uppal', '500039'], ['Dilsukhnagar', '500060'], ['Miyapur', '500049'], ['Ameerpet', '500016'], ['Secunderabad', '500003'], ['Banjara Hills', '500034'], ['Warangal', '506002'], ['Karimnagar', '505001'], ['Khammam', '507001'], ['Nizamabad', '503001'], ['Vijayawada', '520010'], ['Guntur', '522002']];

// student groups: dept, section name, id prefix, first number, count, batch, semester
const GROUPS = [
  { d: 'CSE', sec: 'A', prefix: '24CSE', from: 4001, n: 20, batch: '2024-2028', sem: 5 },
  { d: 'CSE', sec: 'B', prefix: '24CSE', from: 4021, n: 14, batch: '2024-2028', sem: 5 },
  { d: 'AIML', sec: 'A', prefix: '24AIML', from: 5001, n: 12, batch: '2024-2028', sem: 5 },
  { d: 'ECE', sec: 'A', prefix: '24ECE', from: 3001, n: 12, batch: '2024-2028', sem: 5 },
  { d: 'EEE', sec: 'A', prefix: '24EEE', from: 2001, n: 10, batch: '2024-2028', sem: 5 },
  { d: 'MECH', sec: 'A', prefix: '24ME', from: 1001, n: 10, batch: '2024-2028', sem: 5 },
  { d: 'CIVIL', sec: 'A', prefix: '24CE', from: 6001, n: 8, batch: '2024-2028', sem: 5 },
  { d: 'MBA', sec: 'A', prefix: '25MBA', from: 7001, n: 10, batch: '2025-2027', sem: 3 },
];
// the six students from the project team (CSE-A): no login account is created, and gender is left blank on purpose
const TEAM: Record<string, [string, string]> = {
  '24CSE4007': ['Vishnupriya', ''], '24CSE4008': ['Nithwesh', ''], '24CSE4009': ['Jashwanth', 'Reddy'],
  '24CSE4010': ['Tharun', ''], '24CSE4011': ['Chandrika', ''], '24CSE4012': ['Sai', 'Vardhan'],
};

async function main() {
  if (!process.argv.includes('--yes')) throw new Error('This deletes all non-admin data. Re-run with --yes to continue.');
  await connectDB();
  console.log('Connected to', mongoose.connection.host, '/', mongoose.connection.name);

  // ---- wipe everything except admin accounts
  for (const model of Object.values(mongoose.connection.models)) {
    if (model.modelName === 'User') await model.deleteMany({ role: { $ne: 'admin' } });
    else if (model.modelName !== 'Settings') await model.deleteMany({});
  }
  const admin: any = await M.User.findOne({ role: 'admin' });
  if (!admin) throw new Error('No admin account found. Create one first (ADMIN_EMAIL / ADMIN_PASSWORD).');

  await M.Settings.findOneAndUpdate(
    { key: 'main' },
    { collegeName: 'Chaitanya (Deemed to be University)', contact: { email: 'info@example.com', phone: '+91 40 5555 0100', address: 'Hyderabad, Telangana, India', website: '' }, attendanceThreshold: 75, passPercentage: 40, libraryFinePerDay: 2, libraryLoanDays: 14 },
    { upsert: true }
  );

  // ---- academic structure
  const dept: Record<string, any> = {}, prog: Record<string, any> = {};
  for (const d of DEPTS) {
    dept[d.code] = await M.Department.create({ name: d.name, code: d.code });
    const [code, name, durationYears, totalSemesters] = d.prog;
    prog[d.code] = await M.Program.create({ name, code, department: dept[d.code]._id, durationYears, totalSemesters });
  }
  const pastYear = await M.AcademicYear.create({ name: '2025-26', startDate: new Date('2025-06-16'), endDate: new Date('2026-05-31'), isCurrent: false });
  const year: any = await M.AcademicYear.create({ name: '2026-27', startDate: new Date('2026-06-15'), endDate: new Date('2027-05-31'), isCurrent: true });
  await M.Semester.create([
    { name: 'Odd Semester 2025-26', number: 1, academicYear: pastYear._id, startDate: new Date('2025-06-16'), endDate: new Date('2025-11-30'), isCurrent: false },
    { name: 'Even Semester 2025-26', number: 2, academicYear: pastYear._id, startDate: new Date('2025-12-15'), endDate: new Date('2026-05-31'), isCurrent: false },
    { name: 'Odd Semester 2026-27', number: 1, academicYear: year._id, startDate: new Date('2026-06-15'), endDate: new Date('2026-11-30'), isCurrent: true },
    { name: 'Even Semester 2026-27', number: 2, academicYear: year._id, startDate: new Date('2026-12-14'), endDate: new Date('2027-05-31'), isCurrent: false },
  ]);

  // ---- faculty
  const faculty: any[] = [];
  for (const [employeeId, firstName, lastName, d, designation] of FACULTY) {
    const email = `${firstName}.${lastName}`.toLowerCase() + '@example.com';
    const user = await account(`${firstName} ${lastName}`, email, 'faculty', employeeId);
    faculty.push(await M.Faculty.create({ user: user._id, employeeId, firstName, lastName, email, phone: `9${String(Math.floor(100000000 + rnd() * 899999999))}`, department: dept[d]._id, designation, joiningDate: new Date(`20${10 + Math.floor(rnd() * 12)}-0${1 + Math.floor(rnd() * 9)}-01`) }));
  }
  for (const d of DEPTS) {
    const head = faculty.find((f, i) => FACULTY[i][3] === d.code);
    await M.Department.updateOne({ _id: dept[d.code]._id }, { head: head._id });
  }

  // ---- sections and subjects
  const sections: Record<string, any> = {}; // "CSE-A"
  for (const g of GROUPS) {
    sections[`${g.d}-${g.sec}`] = await M.Section.create({ name: g.sec, program: prog[g.d]._id, department: dept[g.d]._id, batch: g.batch, semester: g.sem, capacity: 60 });
  }
  const subjects: any[] = [];
  for (const g of GROUPS) {
    const list = SUBJECTS[g.d];
    if (g.sec !== 'A') continue; // CSE-B shares CSE subjects (created once)
    for (const [code, name, credits, type, fi] of list) {
      subjects.push(await M.Subject.create({ code: g.d === 'MBA' ? code : code, name, credits, type, department: dept[g.d]._id, program: prog[g.d]._id, semester: g.sem, faculty: faculty[fi]._id }));
    }
  }
  const subjectsOf = (d: string) => subjects.filter((s) => String(s.program) === String(prog[d]._id));

  // ---- students (with login accounts) and parents
  const students: any[] = [];
  const nameKeys = new Set<string>();
  let k = 0;
  for (const g of GROUPS) {
    for (let j = 0; j < g.n; j++, k++) {
      const studentId = `${g.prefix}${g.from + j}`;
      const team = TEAM[studentId];
      let firstName: string, lastName: string, gender: string | undefined;
      if (team) {
        [firstName, lastName] = team;
        gender = undefined;
      } else {
        const female = k % 2 === 1;
        do {
          firstName = pick(female ? FEMALE : MALE);
          lastName = pick(LAST);
        } while (nameKeys.has(firstName + lastName));
        gender = female ? 'female' : 'male';
      }
      nameKeys.add(firstName + lastName);
      const email = `${studentId.toLowerCase()}@example.com`;
      // team members get no login: they sign up themselves (Register page) with their admission number and this email
      const user = team ? null : await account(`${firstName} ${lastName}`.trim(), email, 'student', studentId);
      const [area, pincode] = pick(AREAS);
      const guardianName = `${pick(g.d === 'MBA' ? MALE : MALE)} ${lastName || pick(LAST)}`;
      const s = await M.Student.create({
        user: user?._id, studentId, firstName, lastName: lastName || '-', email,
        phone: `${pick(['98', '99', '90', '91', '70', '63'])}${String(10000000 + Math.floor(rnd() * 89999999))}`,
        gender, dateOfBirth: new Date(Date.UTC(g.d === 'MBA' ? 2002 : 2006, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27))),
        address: { line1: `H.No ${1 + Math.floor(rnd() * 90)}-${1 + Math.floor(rnd() * 99)}, ${area}`, city: ['Warangal', 'Karimnagar', 'Khammam', 'Nizamabad', 'Vijayawada', 'Guntur'].includes(area) ? area : 'Hyderabad', state: ['Vijayawada', 'Guntur'].includes(area) ? 'Andhra Pradesh' : 'Telangana', pincode, country: 'India' },
        guardian: { name: guardianName, relation: 'Father', phone: `98${String(10000000 + Math.floor(rnd() * 89999999))}`, email: `parent.${studentId.toLowerCase()}@example.com` },
        emergencyContact: { name: guardianName, phone: `98${String(10000000 + Math.floor(rnd() * 89999999))}`, relation: 'Father' },
        department: dept[g.d]._id, program: prog[g.d]._id, batch: g.batch, academicYear: year._id, semester: g.sem,
        section: sections[`${g.d}-${g.sec}`]._id, admissionYear: Number(g.batch.slice(0, 4)), admissionDate: new Date(`${g.batch.slice(0, 4)}-07-${10 + Math.floor(rnd() * 10)}`), status: 'active',
      });
      await syncEnrollments(s);
      students.push(s);
    }
  }
  const parentOf = students.filter((s, i) => i % 7 === 0 && !TEAM[s.studentId]).slice(0, 8);
  for (const s of parentOf) {
    const u = await account(s.guardian.name, s.guardian.email, 'parent', `parent of ${s.studentId}`);
    u.children = [s._id];
    await u.save();
  }

  // ---- timetable (greedy, no clashes)
  const PERIODS = [['09:00', '10:00'], ['10:00', '11:00'], ['11:15', '12:15'], ['12:15', '13:15'], ['14:00', '15:00'], ['15:00', '16:00']];
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const busyFaculty = new Set<string>();
  const timetable: any[] = [];
  let si = 0;
  for (const g of GROUPS) {
    const sec = sections[`${g.d}-${g.sec}`];
    const busySection = new Set<string>();
    const room = `${g.d.slice(0, 3)}-${101 + si}`;
    const subs = subjectsOf(g.d);
    const place = (sub: any, periods: number[], dIdx: number) => {
      const fid = String(sub.faculty);
      if (periods.some((p) => busySection.has(`${dIdx}-${p}`) || busyFaculty.has(`${fid}-${dIdx}-${p}`))) return false;
      periods.forEach((p) => { busySection.add(`${dIdx}-${p}`); busyFaculty.add(`${fid}-${dIdx}-${p}`); });
      timetable.push({ day: DAYS[dIdx], startTime: PERIODS[periods[0]][0], endTime: PERIODS[periods[periods.length - 1]][1], subject: sub._id, faculty: sub.faculty, room: sub.type === 'practical' ? `LAB-${g.d.slice(0, 3)}` : room, section: sec._id });
      return true;
    };
    subs.filter((s) => s.type === 'practical').forEach((s, i) => { for (let t = 0; t < 6 && !place(s, [4, 5], (si + i + t) % 5); t++); });
    subs.filter((s) => s.type !== 'practical').forEach((s, i) => {
      let placed = 0;
      for (let t = 0; t < 40 && placed < 4; t++) {
        const dIdx = (i + t) % 6;
        if (timetable.some((e) => String(e.subject) === String(s._id) && e.day === DAYS[dIdx] && String(e.section) === String(sec._id))) continue;
        for (const p of [0, 1, 2, 3, 4, 5].sort(() => 0)) if (place(s, [p], dIdx)) { placed++; break; }
      }
    });
    si++;
  }
  await M.Timetable.insertMany(timetable);

  // ---- attendance (last 20 weekdays) and marks
  const enrollments: any[] = await M.Enrollment.find().lean();
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const days: Date[] = [];
  for (let d = -1; days.length < 20; d--) if (![0, 6].includes(day(d).getUTCDay())) days.push(day(d));
  const attendance: any[] = [], marks: any[] = [];
  const quality = new Map<string, number>(), ability = new Map<string, number>();
  for (const s of students) { quality.set(String(s._id), 0.62 + rnd() * 0.38); ability.set(String(s._id), 0.45 + rnd() * 0.5); }
  for (const e of enrollments) {
    const stu = studentById.get(String(e.student))!, sub = subjects.find((s) => String(s._id) === String(e.subject));
    const fac = faculty.find((f) => String(f._id) === String(sub.faculty));
    const q = quality.get(String(stu._id))!, a = ability.get(String(stu._id))!;
    for (const dt of days) {
      const r = rnd();
      attendance.push({ subject: sub._id, section: stu.section, student: stu._id, date: dt, status: r < q ? 'present' : r < q + 0.04 ? 'late' : r < q + 0.07 ? 'excused' : 'absent', markedBy: fac.user });
    }
    const types: [string, number][] = sub.type === 'practical' ? [['internal', 25]] : [['quiz', 10], ['internal', 20]];
    for (const [examType, max] of types) {
      marks.push({ student: stu._id, subject: sub._id, semester: stu.semester, examType, maxMarks: max, marksObtained: Math.round(max * Math.min(1, Math.max(0.2, a + (rnd() - 0.5) * 0.25)) * 2) / 2, enteredBy: fac.user });
    }
  }
  await M.Attendance.insertMany(attendance);
  await M.Mark.insertMany(marks);

  // ---- assignments and submissions
  const assignmentTitles: Record<string, [string, string][]> = {
    CS501: [['Process scheduling simulator', 'Implement FCFS, SJF and Round Robin scheduling in C and compare average waiting times.'], ['Deadlock detection report', 'Write a report with an example of Banker\'s algorithm.']],
    CS502: [['ER model for a hospital', 'Design the ER diagram and relational schema (up to 3NF) for a hospital management system.'], ['SQL query set 2', 'Solve the 15 queries on joins and nested subqueries.']],
    CS503: [['Subnetting problems', 'Solve the subnetting and CIDR problems given in class.']],
    CS504: [['Divide and conquer analysis', 'Analyse merge sort and quick sort with recurrence relations.']],
    CS505: [['DFA and NFA construction', 'Construct and minimise DFAs for the given regular languages.']],
    AI501: [['Linear regression from scratch', 'Implement gradient descent for linear regression and plot the loss curve.']],
    AI502: [['CNN on MNIST', 'Train a small CNN on MNIST and report accuracy and the confusion matrix.']],
    AI503: [['Tokenisation and TF-IDF', 'Build a TF-IDF search over a small text corpus.']],
    EC501: [['DFT and FFT comparison', 'Compare the computational cost of DFT and FFT using MATLAB or Python.']],
    EC502: [['8086 assembly programs', 'Write assembly programs for sorting and string reversal.']],
    EE501: [['Per-unit system problems', 'Solve the per-unit conversion problems and draw the single-line diagram.']],
    EE502: [['Routh-Hurwitz stability', 'Determine the stability of the given systems.']],
    ME501: [['Conduction in composite walls', 'Solve the numerical problems on 1-D steady conduction.']],
    ME502: [['Shaft design problem', 'Design a shaft for the given torque and bending moment.']],
    CE501: [['Analysis of continuous beams', 'Analyse the beams using moment distribution.']],
    CE502: [['Soil classification report', 'Classify the given soil samples using IS classification.']],
    MB301: [['Case study: Porter\'s Five Forces', 'Analyse an Indian industry of your choice using Porter\'s Five Forces.']],
    MB302: [['Capital budgeting exercise', 'Compute NPV and IRR for the given project cash flows.']],
  };
  const assignments: any[] = [];
  let ai = 0;
  for (const sub of subjects) {
    for (const [title, description] of assignmentTitles[sub.code] || []) {
      const past = ai % 2 === 0;
      assignments.push(await M.Assignment.create({ title, description, subject: sub._id, sections: [], deadline: day(past ? -(6 + (ai % 5)) : 5 + (ai % 9)), maxMarks: pick([10, 15, 20]), createdBy: faculty.find((f) => String(f._id) === String(sub.faculty)).user }));
      ai++;
    }
  }
  const submissions: any[] = [];
  for (const asg of assignments) {
    const subEnrollments = enrollments.filter((e) => String(e.subject) === String(asg.subject));
    const isPast = asg.deadline < day(0);
    const fac = faculty.find((f) => subjects.find((s) => String(s._id) === String(asg.subject)) && String(f._id) === String(subjects.find((s) => String(s._id) === String(asg.subject)).faculty));
    for (const e of subEnrollments) {
      if (rnd() > (isPast ? 0.88 : 0.35)) continue;
      const late = isPast && rnd() < 0.1;
      const evaluated = isPast && rnd() < 0.85;
      submissions.push({
        assignment: asg._id, student: e.student, text: 'Submitted the solution as per the assignment instructions. Please find my answers below.',
        submittedAt: new Date(asg.deadline.getTime() - (late ? -3 : 2 + rnd() * 3) * 86400000),
        status: evaluated ? 'evaluated' : late ? 'late' : 'submitted',
        ...(evaluated ? { marks: Math.round(asg.maxMarks * (0.55 + rnd() * 0.45)), feedback: pick(['Good work. Explain the steps more clearly.', 'Well structured answer.', 'Correct approach, a few calculation errors.', 'Needs more detail in the analysis.', 'Excellent, keep it up.']), evaluatedBy: fac.user, evaluatedAt: new Date(asg.deadline.getTime() + 2 * 86400000) } : {}),
      });
    }
  }
  await M.Submission.insertMany(submissions);

  // ---- exams: mid-semester 1 (upcoming) per programme
  const exams: any[] = [];
  for (const g of GROUPS.filter((x) => x.sec === 'A')) {
    let dOff = 14;
    for (const sub of subjectsOf(g.d).filter((s) => s.type !== 'practical')) {
      while ([0, 6].includes(day(dOff).getUTCDay())) dOff++;
      const dept_f = faculty.filter((f) => String(f.department) === String(dept[g.d]._id));
      exams.push({ name: `Mid Semester 1 - ${sub.name}`, type: 'mid', subject: sub._id, program: prog[g.d]._id, semester: g.sem, date: day(dOff), startTime: '10:00', endTime: '11:30', room: `Exam Hall ${1 + (exams.length % 4)}`, invigilators: [pick(dept_f)._id], maxMarks: 30, isPublished: true });
      dOff++;
    }
    const lab = subjectsOf(g.d).find((s) => s.type === 'practical');
    if (lab) exams.push({ name: `Practical Examination - ${lab.name}`, type: 'practical', subject: lab._id, program: prog[g.d]._id, semester: g.sem, date: day(45), startTime: '09:30', endTime: '12:30', room: `LAB-${g.d.slice(0, 3)}`, invigilators: [faculty[FACULTY.findIndex((f) => f[3] === g.d)]._id], maxMarks: 50, isPublished: true });
  }
  await M.Exam.insertMany(exams);

  // ---- notices and calendar
  await M.Notice.create([
    { title: 'Mid Semester 1 examination schedule', description: 'The Mid Semester 1 examinations begin in two weeks. The detailed schedule is available under Examinations. Students must carry their ID cards and report to the hall 15 minutes early.', audience: 'students', priority: 'high', publishDate: day(-2), createdBy: admin._id },
    { title: 'Holiday on account of Vijayadashami (Dussehra)', description: 'The university will remain closed on 20 October 2026 on account of Vijayadashami. Classes resume on the next working day.', audience: 'all', priority: 'normal', publishDate: day(-1), createdBy: admin._id },
    { title: 'Semester fee payment reminder', description: 'Students with pending semester fees are requested to pay at the accounts section or online before the due date to avoid a late fee. Contact the accounts office for instalment requests.', audience: 'students', priority: 'high', publishDate: day(-4), createdBy: admin._id },
    { title: 'Campus placement drive: registrations open', description: 'Registrations for the upcoming campus recruitment drives are open under Placements. Eligible final- and pre-final-year students should update their profile and apply before the deadline.', audience: 'students', priority: 'normal', publishDate: day(-3), createdBy: admin._id },
    { title: 'Chaitanya TechFest 2026 - call for participation', description: 'Teams are invited to register for the hackathon, coding contest and project expo. Contact your department coordinator to register.', audience: 'all', priority: 'normal', publishDate: day(-6), expiryDate: day(40), createdBy: admin._id },
    { title: 'Academic council meeting', description: 'All faculty members are requested to attend the academic council meeting at 4:00 PM in the Seminar Hall. Please bring your internal assessment records.', audience: 'faculty', priority: 'high', publishDate: day(-1), createdBy: admin._id },
    { title: 'Submit internal marks', description: 'Faculty are requested to enter Internal and Quiz marks for all subjects in the portal before the mid-semester examinations.', audience: 'faculty', priority: 'normal', publishDate: day(-5), createdBy: admin._id },
    { title: 'Library timings during examinations', description: 'The central library will remain open from 8:00 AM to 8:00 PM during the examination period. Overdue books must be returned before the exams.', audience: 'all', priority: 'low', publishDate: day(-7), createdBy: admin._id },
    { title: 'Anti-ragging and student conduct', description: 'Ragging is strictly prohibited. Any incident should be reported to the anti-ragging committee immediately. Violations will attract disciplinary action as per UGC regulations.', audience: 'students', priority: 'normal', publishDate: day(-20), createdBy: admin._id },
    { title: 'Parent-teacher meeting', description: 'A parent-teacher meeting is planned after the Mid Semester 1 examinations. Parents are requested to attend and discuss their ward\'s progress.', audience: 'parents', priority: 'normal', publishDate: day(-2), createdBy: admin._id },
    { title: 'CSE: Guest lecture on cloud computing', description: 'The CSE department is organising a guest lecture on cloud-native application development. Attendance is open to CSE and AIML students.', audience: 'students', department: dept.CSE._id, priority: 'low', publishDate: day(-1), createdBy: admin._id },
  ]);
  await M.CalendarEvent.create([
    { title: 'Mid Semester 1 examinations', type: 'exam', startDate: day(14), endDate: day(24), audience: 'all', createdBy: admin._id },
    { title: 'Vijayadashami (Dussehra) - holiday', type: 'holiday', startDate: new Date('2026-10-20'), audience: 'all', createdBy: admin._id },
    { title: 'Chaitanya TechFest 2026', type: 'event', startDate: day(35), endDate: day(37), description: 'Hackathon, coding contests and project expo.', audience: 'all', createdBy: admin._id },
    { title: 'Guest lecture: Cloud-native development', type: 'seminar', startDate: day(6), audience: 'students', createdBy: admin._id },
    { title: 'Last date for fee payment', type: 'deadline', startDate: day(12), audience: 'students', createdBy: admin._id },
    { title: 'Practical examinations', type: 'exam', startDate: day(45), endDate: day(50), audience: 'all', createdBy: admin._id },
    { title: 'Semester end examinations', type: 'exam', startDate: new Date('2026-12-01'), endDate: new Date('2026-12-14'), audience: 'all', createdBy: admin._id },
    { title: 'Christmas - holiday', type: 'holiday', startDate: new Date('2026-12-25'), audience: 'all', createdBy: admin._id },
    { title: 'Sankranti vacation', type: 'holiday', startDate: new Date('2027-01-13'), endDate: new Date('2027-01-17'), audience: 'all', createdBy: admin._id },
    { title: 'Republic Day', type: 'holiday', startDate: new Date('2027-01-26'), audience: 'all', createdBy: admin._id },
  ]);

  // ---- fees
  const FEE_TYPES: [string, number, number][] = [['Semester 5 Tuition Fee', 85000, 12], ['Examination Fee', 3500, 20], ['Library and Laboratory Fee', 6000, 12]];
  const methods = ['upi', 'netbanking', 'card', 'cash'];
  let receipt = 1000;
  for (const g of GROUPS) {
    const gs = students.filter((s) => String(s.program) === String(prog[g.d]._id));
    for (const [name, amount0, due] of FEE_TYPES) {
      const amount = g.d === 'MBA' ? Math.round(amount0 * 1.25) : amount0;
      const fs = await M.FeeStructure.create({ name: g.d === 'MBA' ? name.replace('Semester 5', 'Semester 3') : name, program: prog[g.d]._id, semester: g.sem, amount, dueDate: day(due) });
      await M.Fee.insertMany(gs.map((s) => {
        const r = rnd();
        const paid = r < 0.55 ? amount : r < 0.75 ? Math.round(amount * 0.5) : 0;
        return { student: s._id, structure: fs._id, title: fs.name, amountDue: amount, amountPaid: paid, dueDate: day(due), payments: paid ? [{ amount: paid, method: pick(methods), receiptNo: `RCT-2026-${receipt++}`, paidAt: day(-1 - Math.floor(rnd() * 12)), recordedBy: admin._id }] : [] };
      }));
    }
  }

  // ---- placements
  const companies = await M.Company.create([
    { name: 'Tata Consultancy Services', industry: 'IT Services', website: 'https://www.tcs.com' },
    { name: 'Infosys', industry: 'IT Services', website: 'https://www.infosys.com' },
    { name: 'Wipro', industry: 'IT Services', website: 'https://www.wipro.com' },
    { name: 'Cognizant', industry: 'IT Services', website: 'https://www.cognizant.com' },
    { name: 'Accenture', industry: 'Consulting', website: 'https://www.accenture.com' },
    { name: 'Tech Mahindra', industry: 'IT Services', website: 'https://www.techmahindra.com' },
    { name: 'Cyient', industry: 'Engineering Services', website: 'https://www.cyient.com' },
    { name: 'L&T Construction', industry: 'Construction', website: 'https://www.lntecc.com' },
    { name: 'Hetero Drugs', industry: 'Pharma', website: 'https://www.heteroworld.com' },
    { name: 'HDFC Bank', industry: 'Banking', website: 'https://www.hdfcbank.com' },
  ]);
  const jobsData: [number, string, string, number, number, string[], number][] = [
    [0, 'Assistant System Engineer', 'Hyderabad', 380000, 6, ['CSE', 'AIML', 'ECE', 'EEE'], 20],
    [1, 'Systems Engineer', 'Hyderabad', 400000, 6, ['CSE', 'AIML', 'ECE'], 25],
    [2, 'Project Engineer', 'Hyderabad', 350000, 6, ['CSE', 'AIML', 'ECE', 'EEE', 'MECH'], 30],
    [3, 'Programmer Analyst Trainee', 'Hyderabad', 420000, 6.5, ['CSE', 'AIML'], 18],
    [4, 'Associate Software Engineer', 'Bengaluru', 460000, 7, ['CSE', 'AIML', 'ECE'], 35],
    [5, 'Software Engineer', 'Hyderabad', 360000, 6, ['CSE', 'AIML', 'ECE'], 28],
    [6, 'Graduate Engineer Trainee', 'Hyderabad', 400000, 6.5, ['ECE', 'EEE', 'MECH'], 32],
    [7, 'Graduate Engineer Trainee (Civil)', 'Hyderabad', 420000, 6.5, ['CIVIL'], 26],
    [9, 'Management Trainee', 'Hyderabad', 500000, 6.5, ['MBA'], 22],
  ];
  const jobs: any[] = [];
  for (const [ci, title, location, pkg, minCgpa, depts, due] of jobsData) {
    jobs.push(await M.Job.create({ company: companies[ci]._id, title, description: `${companies[ci].name} is hiring for the role of ${title}. Selection includes an online assessment followed by technical and HR interviews.`, location, package: pkg, eligibility: { minCgpa, programs: depts.map((d) => prog[d]._id), maxActiveBacklogs: 0 }, deadline: day(due), isPublished: true }));
  }
  const apps: any[] = [];
  const stat = ['applied', 'applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected'];
  for (const job of jobs) {
    const elig = students.filter((s) => job.eligibility.programs.some((p) => String(p) === String(s.program)));
    for (const s of elig) {
      if (rnd() > 0.4) continue;
      const status = pick(stat);
      apps.push({ job: job._id, student: s._id, status, history: [{ status: 'applied', at: day(-5) }, ...(status !== 'applied' ? [{ status, at: day(-2), by: admin._id }] : [])] });
    }
  }
  await M.Application.insertMany(apps);

  // ---- library
  const BOOKS: [string, string[], string, string, number][] = [
    ['Introduction to Algorithms', ['Cormen', 'Leiserson', 'Rivest', 'Stein'], '9780262033848', 'Computer Science', 6],
    ['Database System Concepts', ['Silberschatz', 'Korth', 'Sudarshan'], '9780078022159', 'Computer Science', 5],
    ['Computer Networks', ['Andrew S. Tanenbaum'], '9780132126953', 'Computer Science', 5],
    ['Operating System Concepts', ['Silberschatz', 'Galvin', 'Gagne'], '9781118063330', 'Computer Science', 6],
    ['Artificial Intelligence: A Modern Approach', ['Stuart Russell', 'Peter Norvig'], '9780136042594', 'Artificial Intelligence', 4],
    ['Pattern Recognition and Machine Learning', ['Christopher Bishop'], '9780387310732', 'Artificial Intelligence', 3],
    ['Digital Signal Processing', ['Proakis', 'Manolakis'], '9780131873742', 'Electronics', 4],
    ['Engineering Thermodynamics', ['P. K. Nag'], '9780070151314', 'Mechanical', 4],
    ['Clean Code', ['Robert C. Martin'], '9780132350884', 'Computer Science', 3],
    ['The Pragmatic Programmer', ['Andrew Hunt', 'David Thomas'], '9780135957059', 'Computer Science', 2],
    ['Electrical Machines', ['P. S. Bimbhra'], '9788174092137', 'Electrical', 4],
    ['Control Systems Engineering', ['I. J. Nagrath', 'M. Gopal'], '9788122420081', 'Electrical', 3],
    ['Design of Machine Elements', ['V. B. Bhandari'], '9780070681798', 'Mechanical', 4],
    ['Structural Analysis', ['R. C. Hibbeler'], '9780134610672', 'Civil', 3],
    ['Principles of Management', ['Harold Koontz'], '9780070620261', 'Management', 4],
    ['Marketing Management', ['Philip Kotler'], '9780133856460', 'Management', 3],
  ];
  const books = await M.Book.create(BOOKS.map(([title, authors, isbn, category, n]) => ({ title, authors, isbn, category, totalCopies: n, availableCopies: n })));
  const borrowers = students.filter((s) => !TEAM[s.studentId]);
  for (let i = 0; i < 24; i++) {
    const book = books[i % books.length], s = borrowers[(i * 3) % borrowers.length];
    const issuedAt = day(-(3 + Math.floor(rnd() * 30)));
    const dueDate = new Date(issuedAt.getTime() + 14 * 86400000);
    const returned = rnd() < 0.45;
    const returnedAt = returned ? new Date(Math.min(Date.now(), dueDate.getTime() + (rnd() < 0.3 ? 3 : -2) * 86400000)) : undefined;
    const lateDays = returned && returnedAt! > dueDate ? Math.ceil((returnedAt!.getTime() - dueDate.getTime()) / 86400000) : 0;
    await M.BookIssue.create({ book: book._id, student: s._id, issuedAt, dueDate, returnedAt, fine: lateDays * 2, issuedBy: admin._id });
    if (!returned) await M.Book.updateOne({ _id: book._id, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } });
  }

  // ---- complaints and achievements (not for the team members)
  const complaintsData: [string, string, string, string, string][] = [
    ['infrastructure', 'Projector not working in room CSE-101', 'The projector in the classroom has not been working since last week, which affects the presentations.', 'medium', 'in_progress'],
    ['library', 'Request for more copies of Operating System Concepts', 'There are not enough copies of the prescribed textbook for the whole section.', 'low', 'resolved'],
    ['fees', 'Fee receipt not generated after online payment', 'I paid the tuition fee online but the receipt is not visible in the portal. Transaction details attached on request.', 'high', 'assigned'],
    ['academic', 'Clash between lab session and tutorial', 'My lab session overlaps with the tutorial class on Wednesday afternoon.', 'medium', 'open'],
    ['hostel', 'Water supply problem in the boys\' hostel block B', 'There has been no water supply in the morning for the last three days.', 'high', 'in_progress'],
    ['administrative', 'Bonafide certificate request', 'I need a bonafide certificate for a bank education loan. Please advise the procedure.', 'low', 'closed'],
  ];
  for (let i = 0; i < complaintsData.length; i++) {
    const [category, subject, description, priority, status] = complaintsData[i];
    const s = borrowers[(i * 5 + 2) % borrowers.length];
    await M.Complaint.create({ student: s._id, category, subject, description, priority, status, assignedTo: status === 'open' ? undefined : admin._id, responses: status === 'open' ? [] : [{ by: admin._id, byName: admin.name, message: status === 'resolved' || status === 'closed' ? 'This has been taken care of. Please confirm if you face the issue again.' : 'We have received your request and it is being looked into.', at: day(-1) }] });
  }
  const achievementsData: [string, string, string, string][] = [
    ['Smart India Hackathon 2026 - Internal round winner', 'hackathon', 'Won the internal round and selected to represent the university.', 'verified'],
    ['NPTEL: Data Structures and Algorithms (Elite)', 'certification', 'Scored in the top 5% in the NPTEL examination.', 'verified'],
    ['AWS Certified Cloud Practitioner', 'certification', 'Completed the foundational AWS certification.', 'verified'],
    ['Inter-University Cricket Tournament - Runners-up', 'sports', 'Represented the university team.', 'verified'],
    ['Chaitanya TechFest 2025 - Code Sprint winner', 'technical', 'First place in the coding contest.', 'pending'],
    ['Classical Dance - Annual Day Performance', 'cultural', 'Performed at the university annual day.', 'pending'],
    ['IEEE Paper presentation - Student Track', 'technical', 'Presented a paper on low-power IoT devices.', 'verified'],
    ['Google Cloud Skills Boost: Arcade badges', 'certification', 'Completed the cloud skills challenge.', 'pending'],
  ];
  for (let i = 0; i < achievementsData.length; i++) {
    const [title, category, description, status] = achievementsData[i];
    const s = borrowers[(i * 4 + 1) % borrowers.length];
    await M.Achievement.create({ student: s._id, title, category, description, date: day(-20 - i * 15), status, ...(status === 'verified' ? { verifiedBy: admin._id, verifiedAt: day(-2) } : {}) });
  }

  // ---- notifications
  const notifications: any[] = [];
  for (const s of students.filter((x) => x.user)) {
    notifications.push({ user: s.user, title: 'Mid Semester 1 schedule published', message: 'Check the Examinations page for dates and halls.', type: 'exam', link: '/exams', isRead: rnd() < 0.4 });
    notifications.push({ user: s.user, title: 'Fee payment reminder', message: 'Pay your pending semester fees before the due date.', type: 'fee', link: '/fees', isRead: rnd() < 0.3 });
  }
  for (const f of faculty) notifications.push({ user: f.user, title: 'Academic council meeting', message: 'Meeting at 4:00 PM in the Seminar Hall.', type: 'notice', link: '/notices', isRead: rnd() < 0.5 });
  await M.Notification.insertMany(notifications);

  fs.mkdirSync('backups', { recursive: true });
  fs.writeFileSync('backups/sample-credentials.csv', creds.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'));
  console.log(`Done. Faculty ${faculty.length}, students ${students.length}, parents ${parentOf.length}, subjects ${subjects.length}, timetable ${timetable.length}, attendance ${attendance.length}, marks ${marks.length}, assignments ${assignments.length}, submissions ${submissions.length}, exams ${exams.length}, applications ${apps.length}.`);
  console.log('Temporary passwords saved to backups/sample-credentials.csv');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
