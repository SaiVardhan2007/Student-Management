'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useFetch } from '@/hooks';
import { api, errorMessage } from '@/lib/api-client';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, PageLoader, StatCard, Tabs } from '@/components/ui';
import { fullName, titleCase } from '@/lib/format';
import { useAuth } from '@/components/providers/auth-provider';

const TYPES = ['assignment', 'quiz', 'internal', 'practical', 'mid', 'final'];

function Entry({ subjects }: any) {
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState('internal');
  const [maxMarks, setMaxMarks] = useState('');
  const sheet = useFetch(`/marks/subject/${subject}`, { examType }, { enabled: !!subject });
  const [values, setValues] = useState<any>({});
  const [errors, setErrors] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sheet.data) return;
    const v: Record<string, any> = {};
    let max = '';
    for (const s of sheet.data.students) {
      const m = s.marks[examType];
      v[s._id] = m ? String(m.marksObtained) : '';
      if (m && !max) max = String(m.maxMarks);
    }
    setValues(v);
    setErrors({});
    setMaxMarks((cur) => max || cur);
  }, [sheet.data, examType]);

  const students = sheet.data?.students || [];
  const max = Number(maxMarks);

  const save = async () => {
    const errs: Record<string, any> = {};
    if (!max || max <= 0) return toast.error('Enter the maximum marks for this component first.');
    const records = [];
    for (const s of students) {
      const raw = values[s._id];
      if (raw === '' || raw == null) continue;
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) errs[s._id] = 'Invalid';
      else if (n > max) errs[s._id] = `Max ${max}`;
      else records.push({ student: s._id, marksObtained: n });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast.error('Fix the highlighted marks before saving.');
    if (!records.length) return toast.error('Enter marks for at least one student.');
    setSaving(true);
    try {
      const res = await api.post('/marks', { subject, examType, maxMarks: max, records });
      toast.success(res.data.data.saved ? `Marks saved (${res.data.data.saved} updated)` : 'No changes to save');
      sheet.reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to save marks. Please check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Enter marks" bodyClass={null}>
      <div className="card-body">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <Field label="Subject" htmlFor="m-sub">
            <select id="m-sub" className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Component" htmlFor="m-type">
            <select id="m-type" className="select" value={examType} onChange={(e) => setExamType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Maximum marks" htmlFor="m-max">
            <input id="m-max" className="input" type="number" min="1" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
          </Field>
        </div>
      </div>
      {!subject ? (
        <EmptyState icon="clipboard" title="Select a subject" message="Choose the subject and component to enter or edit marks." />
      ) : sheet.loading ? (
        <PageLoader />
      ) : sheet.error ? (
        <ErrorState message={sheet.error} onRetry={sheet.reload} />
      ) : !students.length ? (
        <EmptyState icon="users" title="No enrolled students" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Student</th>
                  <th style={{ width: 180 }}>Marks {max ? `(of ${max})` : ''}</th>
                  <th>Current %</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const cur = s.marks[examType];
                  return (
                    <tr key={s._id}>
                      <td data-label="ID">{s.studentId}</td>
                      <td data-label="Student">
                        <strong>{fullName(s)}</strong>
                      </td>
                      <td data-label="Marks">
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max={max || undefined}
                          step="0.5"
                          value={values[s._id] ?? ''}
                          aria-label={`Marks for ${fullName(s)}`}
                          aria-invalid={!!errors[s._id]}
                          onChange={(e) => {
                            setValues({ ...values, [s._id]: e.target.value });
                            if (errors[s._id]) setErrors({ ...errors, [s._id]: undefined });
                          }}
                        />
                        {errors[s._id] && (
                          <span className="field-error" role="alert">
                            {errors[s._id]}
                          </span>
                        )}
                      </td>
                      <td data-label="Current %">
                        {cur ? (
                          `${Math.round((cur.marksObtained / cur.maxMarks) * 1000) / 10}%`
                        ) : (
                          <span className="faint">Not entered</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="small">{students.length} students · leave blank to skip</span>
            <Button variant="primary" onClick={save} loading={saving}>
              Save marks
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Performance({ subjects }: any) {
  const [subject, setSubject] = useState('');
  const { data, loading, error, reload } = useFetch(`/marks/subject/${subject}/performance`, undefined, { enabled: !!subject });
  return (
    <div className="stack">
      <Card>
        <Field label="Subject" htmlFor="p-sub">
          <select id="p-sub" className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Select subject</option>
            {subjects.map((s) => (
              <option key={s._id} value={s._id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </Field>
      </Card>
      {!subject ? (
        <EmptyState icon="chart" title="Select a subject to see class performance" />
      ) : loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data.students ? (
        <EmptyState icon="chart" title="No marks entered yet" />
      ) : (
        <>
          <div className="grid grid-stats">
            <StatCard label="Students graded" value={data.students} />
            <StatCard label="Average" value={`${data.average}%`} />
            <StatCard label="Highest" value={`${data.highest}%`} />
            <StatCard label="Lowest" value={`${data.lowest}%`} />
            <StatCard label="Pass rate" value={`${data.passRate}%`} />
          </div>
          <Card title="Grade distribution">
            <div className="row">
              {data.gradeDistribution.map((g) => (
                <Badge key={g.grade} tone="primary">
                  {g.grade}: {g.count}
                </Badge>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function Marks() {
  const { user } = useAuth();
  const [tab, setTab] = useState('entry');
  const {
    data: subjects,
    loading,
    error,
    reload,
  } = useFetch('/subjects', { mine: user.role === 'faculty' ? 'true' : undefined, limit: 100, sort: 'code' });
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!subjects.length)
    return <EmptyState icon="book" title="No subjects available" message="Ask the administrator to assign subjects to you." />;
  return (
    <div className="page">
      <PageHeader title="Marks" subtitle="Enter component marks and review class performance. Changes are recorded in the audit log." />
      <Alert tone="info">
        Total = sum of all entered components per subject; grade and SGPA/CGPA use the grading scale configured in Settings.
      </Alert>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'entry', label: 'Enter marks' },
          { value: 'performance', label: 'Class performance' },
        ]}
      />
      {tab === 'entry' ? <Entry subjects={subjects} /> : <Performance subjects={subjects} />}
    </div>
  );
}
