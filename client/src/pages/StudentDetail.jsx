import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFetch } from '../hooks/index.js';
import { Alert, Avatar, Badge, Button, Card, ErrorState, PageHeader, PageLoader, ProgressBar, Tabs } from '../components/ui.jsx';
import { fmtDate, fullName, titleCase } from '../utils/format.js';

export function AttendanceSummaryView({ studentId }) {
  const { data, loading, error, reload } = useFetch(`/attendance/student/${studentId}/summary`);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const { overall, subjects, months, threshold } = data;
  return (
    <div className="stack">
      {overall.belowThreshold && <Alert tone="warning">Overall attendance ({overall.percentage}%) is below the required {threshold}%.</Alert>}
      <div className="grid grid-stats">
        <div className="card stat"><span className="stat-label">Overall</span><span className="stat-value">{overall.percentage ?? '—'}{overall.percentage != null && '%'}</span><span className="stat-sub">{overall.present + overall.late} attended of {overall.present + overall.late + overall.absent} sessions</span></div>
        <div className="card stat"><span className="stat-label">Absent</span><span className="stat-value">{overall.absent}</span></div>
        <div className="card stat"><span className="stat-label">Late</span><span className="stat-value">{overall.late}</span></div>
        <div className="card stat"><span className="stat-label">Excused</span><span className="stat-value">{overall.excused}</span></div>
      </div>
      <Card title="Subject-wise">
        {!subjects.length ? <p className="muted">No attendance recorded yet.</p> : (
          <div className="stack">{subjects.map((s) => (
            <div key={s.subject}>
              <div className="row-between small"><span>{s.code} · {s.name}</span><span><strong>{s.percentage ?? '—'}%</strong> <span className="faint">({s.present + s.late}/{s.present + s.late + s.absent})</span> {s.belowThreshold && <Badge tone="danger">Low</Badge>}</span></div>
              <ProgressBar value={s.percentage} threshold={threshold} />
            </div>
          ))}</div>
        )}
      </Card>
      <Card title="Monthly">
        {!months.length ? <p className="muted">No data.</p> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Month</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>%</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.present}</td><td>{m.late}</td><td>{m.absent}</td><td>{m.excused}</td><td>{m.percentage ?? '—'}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

export function ResultsView({ studentId }) {
  const { data, loading, error, reload } = useFetch(`/marks/student/${studentId}/results`);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data.subjects.length) return <p className="muted">No marks have been published yet.</p>;
  return (
    <div className="stack">
      <div className="grid grid-stats">
        <div className="card stat"><span className="stat-label">CGPA</span><span className="stat-value">{data.cgpa}</span></div>
        {data.semesters.map((s) => <div key={s.semester} className="card stat"><span className="stat-label">Semester {s.semester} SGPA</span><span className="stat-value">{s.sgpa}</span><span className="stat-sub">{s.credits} credits</span></div>)}
      </div>
      <Card title="Subject results" bodyClass={null}>
        <div className="table-wrap"><table className="table responsive"><thead><tr><th>Subject</th><th>Sem</th><th>Components</th><th>Total</th><th>%</th><th>Grade</th><th>Result</th></tr></thead>
          <tbody>{data.subjects.map((s) => (
            <tr key={s.subject._id}>
              <td data-label="Subject">{s.subject.code} · {s.subject.name}</td>
              <td data-label="Sem">{s.subject.semester}</td>
              <td data-label="Components" className="small">{s.components.map((c) => `${titleCase(c.examType)}: ${c.marksObtained}/${c.maxMarks}`).join(' · ')}</td>
              <td data-label="Total">{s.total}/{s.maxTotal}</td>
              <td data-label="%">{s.percentage}%</td>
              <td data-label="Grade"><strong>{s.grade}</strong></td>
              <td data-label="Result"><Badge tone={s.passed ? 'success' : 'danger'}>{s.passed ? 'Pass' : 'Fail'}</Badge></td>
            </tr>))}</tbody></table></div>
      </Card>
    </div>
  );
}

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: s, loading, error, reload } = useFetch(`/students/${id}`);
  const enroll = useFetch(`/students/${id}/enrollments`);
  const [tab, setTab] = useState('profile');

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const row = (k, v) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v || '—'}</dd>];
  const addr = s.address ? [s.address.line1, s.address.city, s.address.state, s.address.pincode].filter(Boolean).join(', ') : '';

  return (
    <div className="page">
      <PageHeader
        title={<span className="row"><Avatar name={fullName(s)} size="lg" /> <span>{fullName(s)}<br /><span className="muted small">{s.studentId} · <Badge value={s.status} /></span></span></span>}
        actions={<Button icon="chevronLeft" onClick={() => navigate(-1)}>Back</Button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'attendance', label: 'Attendance' }, { value: 'results', label: 'Results' }, { value: 'subjects', label: 'Subjects' }]} />
      {tab === 'profile' && (
        <div className="grid grid-2">
          <Card title="Personal">
            <dl className="kv">{[...row('Email', s.email), ...row('Phone', s.phone), ...row('Date of birth', fmtDate(s.dateOfBirth)), ...row('Gender', titleCase(s.gender || '')), ...row('Address', addr)]}</dl>
          </Card>
          <Card title="Academic">
            <dl className="kv">{[...row('Department', s.department?.name), ...row('Program', s.program?.name), ...row('Semester', s.semester), ...row('Section', s.section?.name), ...row('Batch', s.batch), ...row('Admission', `${s.admissionYear || ''} ${s.admissionDate ? `(${fmtDate(s.admissionDate)})` : ''}`)]}</dl>
          </Card>
          <Card title="Guardian">
            <dl className="kv">{[...row('Name', s.guardian?.name), ...row('Relation', s.guardian?.relation), ...row('Phone', s.guardian?.phone), ...row('Email', s.guardian?.email)]}</dl>
          </Card>
          <Card title="Emergency contact">
            <dl className="kv">{[...row('Name', s.emergencyContact?.name), ...row('Phone', s.emergencyContact?.phone)]}</dl>
          </Card>
        </div>
      )}
      {tab === 'attendance' && <AttendanceSummaryView studentId={id} />}
      {tab === 'results' && <ResultsView studentId={id} />}
      {tab === 'subjects' && (
        <Card title="Enrolled subjects" bodyClass={null}>
          {enroll.loading ? <PageLoader /> : enroll.error ? <ErrorState message={enroll.error} onRetry={enroll.reload} /> : !enroll.data.length ? <p className="muted" style={{ padding: 16 }}>Not enrolled in any subject.</p> : (
            <div className="table-wrap"><table className="table responsive"><thead><tr><th>Code</th><th>Subject</th><th>Type</th><th>Credits</th><th>Faculty</th><th>Status</th></tr></thead>
              <tbody>{enroll.data.map((e) => e.subject && (
                <tr key={e._id}><td data-label="Code">{e.subject.code}</td><td data-label="Subject">{e.subject.name}</td><td data-label="Type">{titleCase(e.subject.type)}</td><td data-label="Credits">{e.subject.credits}</td><td data-label="Faculty">{e.subject.faculty ? fullName(e.subject.faculty) : '—'}</td><td data-label="Status"><Badge value={e.status} /></td></tr>
              ))}</tbody></table></div>
          )}
        </Card>
      )}
    </div>
  );
}
