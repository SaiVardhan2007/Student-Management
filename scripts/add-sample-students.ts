/**
 * Adds a sample academic structure and six sample students (with login accounts). Idempotent: existing records are kept.
 *
 *   MONGODB_URI='<uri>' npx tsx scripts/add-sample-students.ts
 *
 * Prints each student's login email and a temporary password (they must change it at first sign-in).
 */
import './env';
import { connectDB, disconnectDB } from '../lib/mongodb';
import { Department, Program, AcademicYear, Semester, Section, Subject, Student, User } from '../models';
import { createAccount } from '../services/accounts';
import { syncEnrollments } from '../services/enrollment';

const STUDENTS = [
  { first: 'Sai', last: 'Vardhan', id: '24CSE4012' },
  { first: 'Jashwanth', last: 'Reddy', id: '24CSE4009' },
  { first: 'Chandrika', last: '', id: '24CSE4011' },
  { first: 'Nithwesh', last: '', id: '24CSE4008' },
  { first: 'Tharun', last: '', id: '24CSE4010' },
  { first: 'Vishnupriya', last: '', id: '24CSE4007' },
];
const BATCH = '2024-2028';
const SEMESTER = 5;

async function main() {
  await connectDB();

  const dept = (await Department.findOne({ code: 'CSE' })) || (await Department.create({ name: 'Computer Science and Engineering', code: 'CSE' }));
  const program =
    (await Program.findOne({ code: 'BTECH-CSE' })) ||
    (await Program.create({ name: 'B.Tech Computer Science and Engineering', code: 'BTECH-CSE', department: dept._id, durationYears: 4, totalSemesters: 8 }));
  const year =
    (await AcademicYear.findOne({ name: '2026-27' })) ||
    (await AcademicYear.create({ name: '2026-27', startDate: new Date('2026-06-15'), endDate: new Date('2027-05-31'), isCurrent: true }));
  if (!(await Semester.exists({ academicYear: year._id, number: SEMESTER }))) {
    await Semester.create({ name: 'Semester 5', number: SEMESTER, academicYear: year._id, startDate: new Date('2026-07-01'), endDate: new Date('2026-11-30'), isCurrent: true });
  }
  const section =
    (await Section.findOne({ program: program._id, batch: BATCH, semester: SEMESTER, name: 'A' })) ||
    (await Section.create({ name: 'A', program: program._id, department: dept._id, batch: BATCH, semester: SEMESTER, capacity: 60 }));

  for (const [code, name, credits, type] of [
    ['CS501', 'Operating Systems', 4, 'theory'],
    ['CS502', 'Database Management Systems', 4, 'theory'],
    ['CS503', 'Computer Networks', 3, 'theory'],
    ['CS504', 'DBMS Laboratory', 2, 'practical'],
  ] as const) {
    if (!(await Subject.exists({ code }))) {
      await Subject.create({ code, name, credits, type, department: dept._id, program: program._id, semester: SEMESTER });
    }
  }

  console.log('\nEmail                                   Student ID   Temporary password');
  for (const [i, s] of STUDENTS.entries()) {
    const email = `${s.id.toLowerCase()}@example.com`;
    let student: any = await Student.findOne({ studentId: s.id });
    if (!student) {
      student = await Student.create({
        studentId: s.id,
        firstName: s.first,
        lastName: s.last || '-',
        email,
        phone: `90000000${String(10 + i)}`,
        dateOfBirth: new Date(`2006-0${i + 1}-1${i + 1}`),
        address: { line1: `${10 + i}, Sample Street`, city: 'Hyderabad', state: 'Telangana', pincode: '500001', country: 'India' },
        guardian: { name: `Guardian of ${s.first}`, relation: 'Parent', phone: `98000000${String(10 + i)}`, email: `guardian.${s.id.toLowerCase()}@example.com` },
        department: dept._id,
        program: program._id,
        batch: BATCH,
        academicYear: year._id,
        semester: SEMESTER,
        section: section._id,
        admissionYear: 2024,
        admissionDate: new Date('2024-07-15'),
        status: 'active',
      });
    }
    await syncEnrollments(student);
    if (student.user || (await User.exists({ email: student.email }))) {
      console.log(`${student.email.padEnd(40)}${s.id.padEnd(13)}(account already exists)`);
      continue;
    }
    const { user, temporaryPassword } = await createAccount({ name: `${student.firstName} ${s.last}`.trim(), email: student.email, role: 'student' });
    student.user = user._id;
    await student.save();
    console.log(`${student.email.padEnd(40)}${s.id.padEnd(13)}${temporaryPassword}`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
