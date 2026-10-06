'use client';

import { useFetch } from '@/hooks';
import { Alert, Badge, Card, ErrorState, PageLoader, ProgressBar } from '@/components/ui';
import { titleCase } from '@/lib/format';

export function AttendanceSummaryView({ studentId }: any) {
  const { data, loading, error, reload } = useFetch(`/attendance/student/${studentId}/summary`);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const { overall, subjects, months, threshold } = data;
  return (
    <div className="stack">
      {overall.belowThreshold && (
        <Alert tone="warning">
          Overall attendance ({overall.percentage}%) is below the required {threshold}%.
        </Alert>
      )}
      <div className="grid grid-stats">
        <div className="card stat">
          <span className="stat-label">Overall</span>
          <span className="stat-value">
            {overall.percentage ?? '—'}
            {overall.percentage != null && '%'}
          </span>
          <span className="stat-sub">
            {overall.present + overall.late} attended of {overall.present + overall.late + overall.absent} sessions
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Absent</span>
          <span className="stat-value">{overall.absent}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Late</span>
          <span className="stat-value">{overall.late}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Excused</span>
          <span className="stat-value">{overall.excused}</span>
        </div>
      </div>
      <Card title="Subject-wise">
        {!subjects.length ? (
          <p className="muted">No attendance recorded yet.</p>
        ) : (
          <div className="stack">
            {subjects.map((s) => (
              <div key={s.subject}>
                <div className="row-between small">
                  <span>
                    {s.code} · {s.name}
                  </span>
                  <span>
                    <strong>{s.percentage ?? '—'}%</strong>{' '}
                    <span className="faint">
                      ({s.present + s.late}/{s.present + s.late + s.absent})
                    </span>{' '}
                    {s.belowThreshold && <Badge tone="danger">Low</Badge>}
                  </span>
                </div>
                <ProgressBar value={s.percentage} threshold={threshold} label={`${s.name} attendance`} />
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Monthly">
        {!months.length ? (
          <p className="muted">No data.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Present</th>
                  <th>Late</th>
                  <th>Absent</th>
                  <th>Excused</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{m.present}</td>
                    <td>{m.late}</td>
                    <td>{m.absent}</td>
                    <td>{m.excused}</td>
                    <td>{m.percentage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ResultsView({ studentId }: any) {
  const { data, loading, error, reload } = useFetch(`/marks/student/${studentId}/results`);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data.subjects.length) return <p className="muted">No marks have been published yet.</p>;
  return (
    <div className="stack">
      <div className="grid grid-stats">
        <div className="card stat">
          <span className="stat-label">CGPA</span>
          <span className="stat-value">{data.cgpa}</span>
        </div>
        {data.semesters.map((s) => (
          <div key={s.semester} className="card stat">
            <span className="stat-label">Semester {s.semester} SGPA</span>
            <span className="stat-value">{s.sgpa}</span>
            <span className="stat-sub">{s.credits} credits</span>
          </div>
        ))}
      </div>
      <Card title="Subject results" bodyClass={null}>
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Sem</th>
                <th>Components</th>
                <th>Total</th>
                <th>%</th>
                <th>Grade</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.subjects.map((s) => (
                <tr key={s.subject._id}>
                  <td data-label="Subject">
                    {s.subject.code} · {s.subject.name}
                  </td>
                  <td data-label="Sem">{s.subject.semester}</td>
                  <td data-label="Components" className="small">
                    {s.components.map((c) => `${titleCase(c.examType)}: ${c.marksObtained}/${c.maxMarks}`).join(' · ')}
                  </td>
                  <td data-label="Total">
                    {s.total}/{s.maxTotal}
                  </td>
                  <td data-label="%">{s.percentage}%</td>
                  <td data-label="Grade">
                    <strong>{s.grade}</strong>
                  </td>
                  <td data-label="Result">
                    <Badge tone={s.passed ? 'success' : 'danger'}>{s.passed ? 'Pass' : 'Fail'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
