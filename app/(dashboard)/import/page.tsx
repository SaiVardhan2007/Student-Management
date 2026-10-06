'use client';

import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { api, downloadFrom, errorMessage } from '@/lib/api-client';
import { Alert, Badge, Button, Card, PageHeader, StatCard } from '@/components/ui';
import { fileProblem } from '@/lib/validation';

function downloadCredentials(created) {
  const rows = [
    'Student ID,Name,Email,Temporary Password',
    ...created.map((c) => [c.studentId, c.name, c.email, c.temporaryPassword].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
  ];
  const url = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'imported-student-credentials.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function Import() {
  const input = useRef(null);
  const [step, setStep] = useState('upload'); // upload | preview | done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [over, setOver] = useState(false);

  const upload = async (file) => {
    setError('');
    const problem = fileProblem(file, { exts: ['csv'], maxMb: 5 });
    if (problem) return setError(problem);
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const res = await api.post('/import/students/preview', fd);
      setPreview(res.data.data);
      setStep('preview');
    } catch (err) {
      setError(errorMessage(err, 'Unable to read that file.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api.post('/import/students/confirm', { importId: preview.importId });
      setResult(res.data.data);
      setStep('done');
      toast.success(res.data.message);
    } catch (err) {
      toast.error(errorMessage(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('upload');
    setPreview(null);
    setResult(null);
    setError('');
    setShowAll(false);
    if (input.current) input.current.value = '';
  };

  const rows = preview ? (showAll ? preview.rows : preview.rows.filter((r) => !r.valid)) : [];

  return (
    <div className="page">
      <PageHeader
        title="Bulk import students"
        subtitle="Upload a CSV, review validation results, then confirm. Nothing is saved until you confirm."
        actions={
          <Button
            icon="download"
            onClick={() =>
              downloadFrom('/import/students/template', {}, 'student-import-template.csv').catch((e) => toast.error(errorMessage(e)))
            }
          >
            Download template
          </Button>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}

      {step === 'upload' && (
        <Card>
          <div
            className={`drop ${over ? 'over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]);
            }}
          >
            {busy ? (
              <p>Validating file…</p>
            ) : (
              <>
                <p>
                  <strong>Drop a CSV file here</strong> or click to browse
                </p>
                <p className="small">
                  Max 2,000 rows · 5 MB. Department and program are matched by <em>code</em> (e.g. CSE, BTECH-CSE).
                </p>
              </>
            )}
          </div>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        </Card>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="grid grid-stats">
            <StatCard label="Rows in file" value={preview.total} />
            <StatCard label="Ready to import" value={preview.validCount} />
            <StatCard
              label="Rows with errors"
              value={preview.invalidCount}
              tone={preview.invalidCount ? 'danger' : ''}
              sub={preview.invalidCount ? 'These rows will be skipped' : ''}
            />
          </div>
          {preview.invalidCount > 0 && (
            <Alert tone="warning">
              Rows with errors are <strong>not imported</strong>. Fix them in your file and upload again, or continue to import only the
              valid rows.
            </Alert>
          )}
          <Card
            title={showAll ? 'All rows' : 'Rows with errors'}
            actions={
              <Button size="sm" onClick={() => setShowAll((s) => !s)}>
                {showAll ? 'Show errors only' : 'Show all rows'}
              </Button>
            }
            bodyClass={null}
          >
            {!rows.length ? (
              <p className="muted" style={{ padding: 16 }}>
                No errors — every row is valid. 🎉
              </p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="table responsive">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line}>
                        <td data-label="Line">{r.line}</td>
                        <td data-label="Student">
                          {r.studentId} {r.name}
                        </td>
                        <td data-label="Email">{r.email}</td>
                        <td data-label="Result">
                          {r.valid ? (
                            <Badge tone="success">Valid</Badge>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--danger)' }}>
                              {r.errors.map((e, i) => (
                                <li key={i} className="small">
                                  {e}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="row">
            <Button onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} loading={busy} disabled={!preview.validCount}>
              Import {preview.validCount} student{preview.validCount === 1 ? '' : 's'}
            </Button>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <>
          <div className="grid grid-stats">
            <StatCard label="Imported" value={result.created.length} />
            <StatCard label="Failed" value={result.failed.length} tone={result.failed.length ? 'danger' : ''} />
          </div>
          {result.created.length > 0 && (
            <Alert tone="warning">
              Temporary passwords are shown only now.{' '}
              <Button size="sm" variant="primary" onClick={() => downloadCredentials(result.created)}>
                Download credentials CSV
              </Button>{' '}
              and distribute securely — students must change them at first login.
            </Alert>
          )}
          {result.failed.length > 0 && (
            <Card title="Rows that failed">
              {result.failed.map((f) => (
                <p key={f.line} className="small">
                  Line {f.line} ({f.studentId}): {f.error}
                </p>
              ))}
            </Card>
          )}
          <div className="row">
            <Button onClick={reset}>Import another file</Button>
            <Link className="btn btn-primary" href="/students">
              View students
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
