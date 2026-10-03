import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from '../hooks/index.js';
import { api, errorMessage } from '../api/client.js';
import { Alert, Badge, Button, Card, ErrorState, Field, Modal, PageHeader, PageLoader } from '../components/ui.jsx';
import DynamicForm from '../components/DynamicForm.jsx';
import FileLink from '../components/FileLink.jsx';
import { fileProblem } from '../utils/validation.js';
import { fmtDateTime, fullName } from '../utils/format.js';

function SubmitForm({ assignment, existing, onDone }) {
  const [files, setFiles] = useState([]);
  const [text, setText] = useState(existing?.text || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    for (const f of files) { const p = fileProblem(f); if (p) return setError(`${f.name}: ${p}`); }
    if (!files.length && !text.trim()) return setError('Attach a file or write your answer before submitting.');
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (text.trim()) fd.append('text', text.trim());
    setBusy(true);
    try {
      const res = await api.post(`/assignments/${assignment._id}/submit`, fd);
      toast.success(res.data.message);
      setFiles([]);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Unable to submit. Please check your connection and try again.'));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      {error && <div className="form-error-summary" role="alert">{error}</div>}
      <Field label="Files (up to 5)" htmlFor="sub-files" hint="PDF, Office, image, text or zip — max 10 MB each">
        <input id="sub-files" className="input" type="file" multiple style={{ paddingTop: 5 }} onChange={(e) => setFiles([...e.target.files].slice(0, 5))} />
      </Field>
      <Field label="Written answer (optional)" htmlFor="sub-text"><textarea id="sub-text" className="textarea" rows={4} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {new Date() > new Date(assignment.deadline) && <Alert tone="warning">The deadline has passed — this submission will be marked as late.</Alert>}
      <div><Button type="submit" variant="primary" loading={busy}>{existing ? 'Resubmit' : 'Submit assignment'}</Button></div>
    </form>
  );
}

function Submissions({ id }) {
  const { data, loading, error, reload } = useFetch(`/assignments/${id}/submissions`);
  const [evaluating, setEvaluating] = useState(null);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const { assignment, rows } = data;
  const done = rows.filter((r) => r.submission).length;
  return (
    <Card title={`Submissions (${done}/${rows.length})`} bodyClass={null}>
      <div className="table-wrap">
        <table className="table responsive">
          <thead><tr><th>ID</th><th>Student</th><th>Status</th><th>Submitted</th><th>Work</th><th>Marks</th><th /></tr></thead>
          <tbody>{rows.map(({ student, submission, status }) => (
            <tr key={student._id}>
              <td data-label="ID">{student.studentId}</td><td data-label="Student"><strong>{fullName(student)}</strong></td>
              <td data-label="Status"><Badge value={status} /></td>
              <td data-label="Submitted">{submission ? fmtDateTime(submission.submittedAt) : '—'}</td>
              <td data-label="Work">{submission ? <div className="stack" style={{ gap: 2 }}>{submission.files.map((f) => <FileLink key={f.path} file={f} />)}{submission.text && <span className="small muted" style={{ maxWidth: 240 }}>“{submission.text.slice(0, 80)}{submission.text.length > 80 ? '…' : ''}”</span>}</div> : '—'}</td>
              <td data-label="Marks">{submission?.marks != null ? `${submission.marks}/${assignment.maxMarks}` : '—'}</td>
              <td className="actions">{submission && <Button size="sm" onClick={() => setEvaluating({ submission, student })}>{submission.status === 'evaluated' ? 'Edit grade' : 'Evaluate'}</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {evaluating && (
        <Modal title={`Evaluate — ${fullName(evaluating.student)}`} onClose={() => setEvaluating(null)} size="sm">
          {evaluating.submission.text && <Alert tone="info"><strong>Answer:</strong> {evaluating.submission.text}</Alert>}
          <div style={{ height: 10 }} />
          <DynamicForm
            initial={{ marks: evaluating.submission.marks ?? '', feedback: evaluating.submission.feedback || '' }}
            fields={[{ name: 'marks', label: `Marks (max ${assignment.maxMarks})`, type: 'number', min: 0, max: assignment.maxMarks, step: 0.5, required: true }, { name: 'feedback', label: 'Feedback', type: 'textarea', maxLength: 2000 }]}
            onSubmit={async (v) => { await api.patch(`/assignments/submissions/${evaluating.submission._id}/evaluate`, { marks: Number(v.marks), ...(v.feedback ? { feedback: v.feedback } : {}) }); toast.success('Evaluation saved'); setEvaluating(null); reload(); }}
            onCancel={() => setEvaluating(null)} submitLabel="Save evaluation" />
        </Modal>
      )}
    </Card>
  );
}

export default function AssignmentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: a, loading, error, reload } = useFetch(`/assignments/${id}`);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const sub = a.submission;
  const isStudent = user.role === 'student';
  const locked = sub?.status === 'evaluated';

  return (
    <div className="page">
      <PageHeader title={a.title} subtitle={`${a.subject?.code} · ${a.subject?.name}`} actions={<Button icon="chevronLeft" onClick={() => navigate('/assignments')}>All assignments</Button>} />
      <Card>
        <dl className="kv">
          <dt>Deadline</dt><dd>{fmtDateTime(a.deadline)} {new Date(a.deadline) < new Date() && <Badge tone="danger">Closed</Badge>}</dd>
          <dt>Maximum marks</dt><dd>{a.maxMarks}</dd>
          <dt>Sections</dt><dd>{a.sections?.length ? a.sections.map((s) => s.name).join(', ') : 'All sections'}</dd>
          <dt>Resource</dt><dd><FileLink file={a.attachment} label="Download attachment" /></dd>
          <dt>Instructions</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{a.description || '—'}</dd>
        </dl>
      </Card>
      {isStudent ? (
        <>
          {sub && (
            <Card title="Your submission">
              <div className="row"><Badge value={sub.status} /><span className="muted small">Submitted {fmtDateTime(sub.submittedAt)}</span></div>
              {sub.status === 'evaluated' && <div className="mt-1"><strong>Marks: {sub.marks}/{a.maxMarks}</strong>{sub.feedback && <p className="muted" style={{ marginTop: 4 }}>Feedback: {sub.feedback}</p>}</div>}
            </Card>
          )}
          {locked ? <Alert tone="info">This submission has been evaluated and can no longer be changed.</Alert> : <Card title={sub ? 'Resubmit' : 'Submit your work'}><SubmitForm assignment={a} existing={sub} onDone={reload} /></Card>}
        </>
      ) : <Submissions id={id} />}
    </div>
  );
}
