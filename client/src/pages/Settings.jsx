import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { useFetch } from '../hooks/index.js';
import DynamicForm from '../components/DynamicForm.jsx';
import { Alert, Button, Card, ErrorState, Field, PageHeader, PageLoader, Tabs } from '../components/ui.jsx';
import { fileProblem } from '../utils/validation.js';

function GradeScale({ initial, onSaved }) {
  const [rows, setRows] = useState(initial.map((g) => ({ ...g })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    setError('');
    const gradeScale = rows.map((r) => ({ grade: String(r.grade).trim(), minPercent: Number(r.minPercent), points: Number(r.points) }));
    if (gradeScale.some((g) => !g.grade || Number.isNaN(g.minPercent) || Number.isNaN(g.points)))
      return setError('Every row needs a grade, a minimum % and grade points.');
    setBusy(true);
    try {
      await api.put('/settings', { gradeScale });
      toast.success('Grading scale saved');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {error && (
        <div className="form-error-summary" role="alert">
          {error}
        </div>
      )}
      <Alert tone="info">
        Percentage ≥ <em>Min %</em> earns that grade. One row must start at 0%. Used for grades, SGPA and CGPA.
      </Alert>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Grade</th>
              <th>Min %</th>
              <th>Grade points</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="input"
                    aria-label={`Grade ${i + 1}`}
                    value={r.grade}
                    maxLength={12}
                    onChange={(e) => set(i, 'grade', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="100"
                    aria-label={`Minimum percent ${i + 1}`}
                    value={r.minPercent}
                    onChange={(e) => set(i, 'minPercent', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    aria-label={`Grade points ${i + 1}`}
                    value={r.points}
                    onChange={(e) => set(i, 'points', e.target.value)}
                  />
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Remove grade ${r.grade}`}
                    disabled={rows.length <= 2}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <Button icon="plus" onClick={() => setRows([...rows, { grade: '', minPercent: '', points: '' }])}>
          Add grade
        </Button>
        <Button variant="primary" onClick={save} loading={busy}>
          Save grading scale
        </Button>
      </div>
    </div>
  );
}

function Logo({ current, onSaved }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    const problem = fileProblem(file, { exts: ['png', 'jpg', 'jpeg'], maxMb: 2 });
    if (problem) return toast.error(problem);
    const fd = new FormData();
    fd.append('logo', file);
    setBusy(true);
    try {
      await api.post('/settings/logo', fd);
      toast.success('Logo updated');
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row">
      <input ref={ref} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files[0] && pick(e.target.files[0])} />
      <Button icon="upload" loading={busy} onClick={() => ref.current?.click()}>
        {current ? 'Replace logo' : 'Upload logo'}
      </Button>
      <span className="small muted">PNG or JPG, max 2 MB</span>
    </div>
  );
}

export default function Settings() {
  const { data, loading, error, reload } = useFetch('/settings');
  const { reload: reloadBranding } = useSettings();
  const [tab, setTab] = useState('general');
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const refresh = () => {
    reload();
    reloadBranding();
  };

  const save = async (v) => {
    await api.put('/settings', {
      collegeName: v.collegeName,
      attendanceThreshold: Number(v.attendanceThreshold),
      passPercentage: Number(v.passPercentage),
      libraryFinePerDay: Number(v.libraryFinePerDay),
      libraryLoanDays: Number(v.libraryLoanDays),
      contact: { email: v.contact?.email || '', phone: v.contact?.phone, address: v.contact?.address, website: v.contact?.website },
    });
    toast.success('Settings saved');
    refresh();
  };

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="College-specific configuration — nothing here is hard-coded" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General & policies' },
          { value: 'grading', label: 'Grading scale' },
        ]}
      />
      {tab === 'general' && (
        <Card>
          <div style={{ marginBottom: 16 }}>
            <Field label="College logo" hint="Shown in the sidebar">
              <Logo current={data.logo} onSaved={refresh} />
            </Field>
          </div>
          <DynamicForm
            initial={{
              collegeName: data.collegeName,
              attendanceThreshold: String(data.attendanceThreshold),
              passPercentage: String(data.passPercentage),
              libraryFinePerDay: String(data.libraryFinePerDay),
              libraryLoanDays: String(data.libraryLoanDays),
              contact: data.contact || {},
            }}
            onSubmit={save}
            submitLabel="Save settings"
            fields={[
              { section: 'Institution' },
              { name: 'collegeName', label: 'College name', required: true, maxLength: 150, span2: true },
              { name: 'contact.email', label: 'Contact email', type: 'email' },
              { name: 'contact.phone', label: 'Contact phone', type: 'tel' },
              { name: 'contact.website', label: 'Website' },
              { name: 'contact.address', label: 'Address' },
              { section: 'Academic policy' },
              {
                name: 'attendanceThreshold',
                label: 'Attendance warning threshold (%)',
                type: 'number',
                min: 0,
                max: 100,
                required: true,
                hint: 'Students below this see a warning',
              },
              { name: 'passPercentage', label: 'Pass percentage', type: 'number', min: 0, max: 100, required: true },
              { section: 'Library' },
              { name: 'libraryLoanDays', label: 'Loan period (days)', type: 'number', min: 1, max: 365, required: true },
              { name: 'libraryFinePerDay', label: 'Fine per overdue day', type: 'number', min: 0, required: true },
            ]}
          />
        </Card>
      )}
      {tab === 'grading' && (
        <Card>
          <GradeScale initial={data.gradeScale} onSaved={refresh} />
        </Card>
      )}
    </div>
  );
}
