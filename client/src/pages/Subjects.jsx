import ResourcePage from '../components/ResourcePage.jsx';
import { Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { SEMESTERS } from './Students.jsx';
import { fullName } from '../utils/format.js';

const TYPES = [{ value: 'theory', label: 'Theory' }, { value: 'practical', label: 'Practical' }, { value: 'elective', label: 'Elective' }];

export default function Subjects() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const fields = isAdmin ? [
    { name: 'code', label: 'Subject code', required: true, maxLength: 20 },
    { name: 'name', label: 'Subject name', required: true },
    { name: 'department', label: 'Department', type: 'select', required: true, optionsUrl: '/departments' },
    { name: 'program', label: 'Program', type: 'select', required: true, optionsUrl: '/programs', filterOptions: (o, v) => (v.department ? o.filter((x) => (x.raw.department?._id || x.raw.department) === v.department) : o) },
    { name: 'semester', label: 'Semester', type: 'select', options: SEMESTERS, required: true },
    { name: 'credits', label: 'Credits', type: 'number', min: 0, max: 30, step: 0.5, required: true },
    { name: 'type', label: 'Type', type: 'select', options: TYPES, required: true },
    { name: 'faculty', label: 'Faculty', type: 'select', optionsUrl: '/faculty', optionLabel: (f) => `${f.firstName} ${f.lastName} (${f.employeeId})` },
    { name: 'sections', label: 'Sections (optional)', type: 'multiselect', optionsUrl: '/sections', optionLabel: (s) => `${s.program?.code || ''} · ${s.name} · Sem ${s.semester}`, hint: 'Leave empty to teach every section of the program and semester' },
  ] : [];

  return (
    <ResourcePage
      title="Subjects" subtitle={isAdmin ? 'Manage subjects and faculty assignment. New subjects auto-enrol matching students.' : 'Your subjects'}
      endpoint="/subjects" entity="subject" initialFilters={user.role === 'admin' ? undefined : { mine: 'true' }} createLabel="Add subject" searchPlaceholder="Search code or name…" defaultSort="code" modalSize="lg"
      defaults={{ type: 'theory', semester: '1' }} fields={fields} canCreate={isAdmin} canEdit={() => isAdmin} canDelete={() => isAdmin}
      deleteMessage={(r) => `Delete ${r.code} — ${r.name}? Enrolments are removed. Subjects with attendance, marks, exams or timetable entries cannot be deleted.`}
      filters={[
        { name: 'department', label: 'Department', optionsUrl: '/departments' }, { name: 'program', label: 'Program', optionsUrl: '/programs' },
        { name: 'semester', label: 'Semester', options: SEMESTERS }, { name: 'type', label: 'Type', options: TYPES },
        ...(user.role !== 'admin' ? [{ name: 'mine', label: 'Scope', options: [{ value: 'true', label: 'My subjects only' }] }] : []),
      ]}
      columns={[
        { key: 'code', label: 'Code', sortKey: 'code', render: (r) => <strong>{r.code}</strong> },
        { key: 'name', label: 'Name', sortKey: 'name' },
        { key: 'program', label: 'Program', render: (r) => r.program?.code || '—' },
        { key: 'semester', label: 'Sem', sortKey: 'semester' },
        { key: 'credits', label: 'Credits', sortKey: 'credits' },
        { key: 'type', label: 'Type', render: (r) => <Badge tone="info">{r.type}</Badge> },
        { key: 'faculty', label: 'Faculty', render: (r) => (r.faculty ? fullName(r.faculty) : <span className="faint">Unassigned</span>) },
      ]}
    />
  );
}
