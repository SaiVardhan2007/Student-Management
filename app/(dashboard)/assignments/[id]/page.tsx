'use client';

// Assignment detail. Everyone sees the assignment info. Students submit (or resubmit) work until
// it is evaluated; faculty/admin see all submissions and give marks and feedback.
// APIs: /assignments/:id, /assignments/:id/submit, /assignments/:id/submissions

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useFetch } from '@/hooks';
import { api, errorMessage } from '@/lib/api-client';
import { Alert, Badge, Button, Card, ErrorState, Field, Modal, PageHeader, PageLoader } from '@/components/ui';
import DynamicForm from '@/components/ui/dynamic-form';
import FileLink from '@/components/ui/file-link';
import { fileProblem } from '@/lib/validation';
import { fmtDateTime, fullName } from '@/lib/format';

/** Student form: upload up to 5 files and/or write an answer. */
function SubmitForm({ assignment, existing, onDone }: any) {
  const [files, setFiles] = useState([]);
  const [text, setText] = useState(existing?.text || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    for (const f of files) {
      const problem = fileProblem(f);
      if (problem) return setError(`${f.name}: ${problem}`);
    }
    if (!files.length && !text.trim()) return setError('Attach a file or write your answer before submitting.');
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (text.trim()) fd.append('text', text.trim());
    setBusy(true);
    try {
      const res = await api.post(`/assignments/${assignment._id}/submit`, fd);
      toast.success(res.data.message);
      setFiles([]);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Unable to submit. Please check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      {error && (
        <div className="form-error-summary" role="alert">
          {error}
        </div>
      )}
      <Field label="Files (up to 5)" htmlFor="sub-files" hint="PDF, Office, image, text or zip — max 10 MB each">
        <input
          id="sub-files"
          className="input"
          type="file"
          multiple
          style={{ paddingTop: 5 }}
          onChange={(e) => setFiles([...e.target.files].slice(0, 5))}
        />
      </Field>
      <Field label="Written answer (optional)" htmlFor="sub-text">
        <textarea id="sub-text" className="textarea" rows={4} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {new Date() > new Date(assignment.deadline) && (
        <Alert tone="warning">The deadline has passed — this submission will be marked as late.</Alert>
      )}
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {existing ? 'Resubmit' : 'Submit assignment'}
        </Button>
      </div>
    </form>
  );
}

/** Modal where faculty give marks and feedback for one submission. */
function EvaluateModal({ assignment, submission, student, onClose, onSaved }: any) {
  const save = async (v) => {
    await api.patch(`/assignments/submissions/${submission._id}/evaluate`, {
      marks: Number(v.marks),
      ...(v.feedback ? { feedback: v.feedback } : {}),
    });
    toast.success('Evaluation saved');
    onSaved();
  };

  return (
    <Modal title={`Evaluate — ${fullName(student)}`} onClose={onClose} size="sm">
      {submission.text && (
        <Alert tone="info">
          <strong>Answer:</strong> {submission.text}
        </Alert>
      )}
      <div style={{ height: 10 }} />
      <DynamicForm
        initial={{ marks: submission.marks ?? '', feedback: submission.feedback || '' }}
        fields={[
          {
            name: 'marks',
            label: `Marks (max ${assignment.maxMarks})`,
            type: 'number',
            min: 0,
            max: assignment.maxMarks,
            step: 0.5,
            required: true,
          },
          { name: 'feedback', label: 'Feedback', type: 'textarea', maxLength: 2000 },
        ]}
        onSubmit={save}
        onCancel={onClose}
        submitLabel="Save evaluation"
      />
    </Modal>
  );
}

/** Staff view: one row per student with their submission (if any) and an evaluate button. */
function Submissions({ id }: any) {
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
          <thead>
            <tr>
              <th>ID</th>
              <th>Student</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Work</th>
              <th>Marks</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, submission, status }) => (
              <tr key={student._id}>
                <td data-label="ID">{student.studentId}</td>
                <td data-label="Student">
                  <strong>{fullName(student)}</strong>
                </td>
                <td data-label="Status">
                  <Badge value={status} />
                </td>
                <td data-label="Submitted">{submission ? fmtDateTime(submission.submittedAt) : '—'}</td>
                <td data-label="Work">
                  {submission ? (
                    <div className="stack" style={{ gap: 2 }}>
                      {submission.files.map((f) => (
                        <FileLink key={f.path} file={f} />
                      ))}
                      {submission.text && (
                        <span className="small muted" style={{ maxWidth: 240 }}>
                          “{submission.text.slice(0, 80)}
                          {submission.text.length > 80 ? '…' : ''}”
                        </span>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td data-label="Marks">{submission?.marks != null ? `${submission.marks}/${assignment.maxMarks}` : '—'}</td>
                <td className="actions">
                  {submission && (
                    <Button size="sm" onClick={() => setEvaluating({ submission, student })}>
                      {submission.status === 'evaluated' ? 'Edit grade' : 'Evaluate'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {evaluating && (
        <EvaluateModal
          assignment={assignment}
          submission={evaluating.submission}
          student={evaluating.student}
          onClose={() => setEvaluating(null)}
          onSaved={() => {
            setEvaluating(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

export default function AssignmentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const router = useRouter();
  const { data: a, loading, error, reload } = useFetch(`/assignments/${id}`);
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const sub = a.submission;
  const isStudent = user.role === 'student';
  // Once evaluated, the student can no longer change the submission.
  const locked = sub?.status === 'evaluated';

  return (
    <div className="page">
      <PageHeader
        title={a.title}
        subtitle={`${a.subject?.code} · ${a.subject?.name}`}
        actions={
          <Button icon="chevronLeft" onClick={() => router.push('/assignments')}>
            All assignments
          </Button>
        }
      />
      <Card>
        <dl className="kv">
          <dt>Deadline</dt>
          <dd>
            {fmtDateTime(a.deadline)} {new Date(a.deadline) < new Date() && <Badge tone="danger">Closed</Badge>}
          </dd>
          <dt>Maximum marks</dt>
          <dd>{a.maxMarks}</dd>
          <dt>Sections</dt>
          <dd>{a.sections?.length ? a.sections.map((s) => s.name).join(', ') : 'All sections'}</dd>
          <dt>Resource</dt>
          <dd>
            <FileLink file={a.attachment} label="Download attachment" />
          </dd>
          <dt>Instructions</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{a.description || '—'}</dd>
        </dl>
      </Card>
      {isStudent ? (
        <>
          {sub && (
            <Card title="Your submission">
              <div className="row">
                <Badge value={sub.status} />
                <span className="muted small">Submitted {fmtDateTime(sub.submittedAt)}</span>
              </div>
              {sub.status === 'evaluated' && (
                <div className="mt-1">
                  <strong>
                    Marks: {sub.marks}/{a.maxMarks}
                  </strong>
                  {sub.feedback && (
                    <p className="muted" style={{ marginTop: 4 }}>
                      Feedback: {sub.feedback}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}
          {locked ? (
            <Alert tone="info">This submission has been evaluated and can no longer be changed.</Alert>
          ) : (
            <Card title={sub ? 'Resubmit' : 'Submit your work'}>
              <SubmitForm assignment={a} existing={sub} onDone={reload} />
            </Card>
          )}
        </>
      ) : (
        <Submissions id={id} />
      )}
    </div>
  );
}
