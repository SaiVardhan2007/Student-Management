'use client';

// Attendance page. Staff (faculty/admin) can mark attendance, see class reports and review
// correction requests. Students and parents see their own record and can request corrections.
// APIs: /attendance/classes, /roster, /class-report, /corrections, /student/:id/history|summary

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { useFetch, useListQuery } from '@/hooks';
import { api, errorMessage } from '@/lib/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  PageLoader,
  ProgressBar,
  Tabs,
} from '@/components/ui';
import DataTable from '@/components/ui/data-table';
import DynamicForm from '@/components/ui/dynamic-form';
import { AttendanceSummaryView } from '@/components/students/student-views';
import { fmtDate, fullName, todayInput } from '@/lib/format';

const STATUS = ['present', 'absent', 'late', 'excused'];

function capitalize(text: string) {
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Loads the classes the user teaches and keeps the chosen subject/section in state.
 * Returns the two dropdowns as ready-made JSX (`picker`) so several tabs can reuse them.
 */
function useClassPicker() {
  const { data, loading, error, reload } = useFetch('/attendance/classes');
  const [subject, setSubject] = useState('');
  const [section, setSection] = useState('');
  const cls = data?.find((c) => c.subject._id === subject);
  // When the subject changes, the old section may not belong to it, so pick the first one.
  useEffect(() => {
    if (cls && !cls.sections.some((s) => s._id === section)) setSection(cls.sections[0]?._id || '');
  }, [cls, section]);
  const picker = (
    <>
      <Field label="Subject" htmlFor="ap-subject">
        <select id="ap-subject" className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">{loading ? 'Loading…' : 'Select subject'}</option>
          {data?.map((c) => (
            <option key={c.subject._id} value={c.subject._id}>
              {c.subject.code} — {c.subject.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Section" htmlFor="ap-section">
        <select id="ap-section" className="select" value={section} onChange={(e) => setSection(e.target.value)} disabled={!cls}>
          {!cls && <option value="">Select subject first</option>}
          {cls?.sections.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
              {s.batch ? ` (${s.batch})` : ''}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
  return { picker, subject, section, classes: data, loading, error, reload };
}

/** Table of students with a status button group and a remarks box for each one. */
function RosterTable({ students, marks, setMarks }: any) {
  const setStatus = (id, status) => setMarks((m) => ({ ...m, [id]: { ...m[id], status } }));
  const setRemarks = (id, remarks) => setMarks((m) => ({ ...m, [id]: { ...m[id], remarks } }));

  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            <th>ID</th>
            <th>Student</th>
            <th>Status</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s._id}>
              <td data-label="ID">{s.studentId}</td>
              <td data-label="Student">
                <strong>{fullName(s)}</strong>
              </td>
              <td data-label="Status">
                <div className="seg" role="group" aria-label={`Attendance for ${fullName(s)}`}>
                  {STATUS.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={st}
                      aria-pressed={marks[s._id]?.status === st}
                      onClick={() => setStatus(s._id, st)}
                    >
                      {capitalize(st)}
                    </button>
                  ))}
                </div>
              </td>
              <td data-label="Remarks">
                <input
                  className="input"
                  style={{ minWidth: 140 }}
                  aria-label={`Remarks for ${fullName(s)}`}
                  maxLength={300}
                  value={marks[s._id]?.remarks || ''}
                  onChange={(e) => setRemarks(s._id, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Staff tab: pick a class and date, mark every student, then save in one request. */
function MarkAttendance() {
  const { picker, subject, section, classes, loading, error, reload } = useClassPicker();
  const [date, setDate] = useState(todayInput());
  const roster = useFetch('/attendance/roster', { subject, section, date }, { enabled: !!(subject && section && date) });
  const [marks, setMarks] = useState<any>({});
  const [saving, setSaving] = useState(false);

  // Fill the form from the saved attendance whenever a new roster is loaded.
  useEffect(() => {
    if (!roster.data) return;
    setMarks(
      Object.fromEntries(
        roster.data.students.map((s) => [s._id, { status: s.attendance?.status || '', remarks: s.attendance?.remarks || '' }])
      )
    );
  }, [roster.data]);

  const students = roster.data?.students || [];
  // How many students have each status, e.g. { present: 20, absent: 2, ... }
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const status of STATUS) {
      result[status] = Object.values(marks).filter((m: any) => m.status === status).length;
    }
    return result;
  }, [marks]);
  const unmarked = students.filter((s) => !marks[s._id]?.status).length;
  const alreadyMarked = students.some((s) => s.attendance);

  const markAll = (status) => setMarks(Object.fromEntries(students.map((s) => [s._id, { ...marks[s._id], status }])));

  const save = async () => {
    if (unmarked) return toast.error(`Please mark all students (${unmarked} still unmarked).`);
    setSaving(true);
    try {
      const records = students.map((s) => ({
        student: s._id,
        status: marks[s._id].status,
        ...(marks[s._id].remarks ? { remarks: marks[s._id].remarks } : {}),
      }));
      const res = await api.post('/attendance', { subject, section, date, records });
      toast.success(res.data.data.saved ? `Attendance saved (${res.data.data.saved} updated)` : 'No changes to save');
      roster.reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to save attendance. Please check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!loading && classes && !classes.length)
    return <EmptyState icon="book" title="No classes assigned" message="Ask the administrator to assign subjects to you." />;

  // Decide what to show under the filters.
  let body;
  if (!subject || !section) {
    body = <EmptyState icon="checkCircle" title="Select a class" message="Choose a subject, section and date to load the student list." />;
  } else if (roster.loading) {
    body = <PageLoader />;
  } else if (roster.error) {
    body = <ErrorState message={roster.error} onRetry={roster.reload} />;
  } else if (!students.length) {
    body = <EmptyState icon="users" title="No students found" message="No active students in this section are enrolled in the subject." />;
  } else {
    body = (
      <>
        <div className="table-toolbar">
          {alreadyMarked && (
            <span className="small" style={{ color: 'var(--info)' }}>
              Already recorded — edits are logged.
            </span>
          )}
          <span className="small muted">
            Present {counts.present} · Absent {counts.absent} · Late {counts.late} · Excused {counts.excused}
            {unmarked ? ` · Unmarked ${unmarked}` : ''}
          </span>
          <span className="grow" />
          <Button size="sm" onClick={() => markAll('present')}>
            All present
          </Button>
          <Button size="sm" onClick={() => markAll('absent')}>
            All absent
          </Button>
        </div>
        <RosterTable students={students} marks={marks} setMarks={setMarks} />
        <div className="pagination">
          <span className="small">{students.length} students</span>
          <Button variant="primary" onClick={save} loading={saving}>
            Save attendance
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card title="Mark attendance" bodyClass={null}>
      <div className="card-body">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {picker}
          <Field label="Date" htmlFor="ap-date">
            <input id="ap-date" className="input" type="date" max={todayInput()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </div>
      {body}
    </Card>
  );
}

/** Staff tab: per-student attendance totals for a class, optionally within a date range. */
function ClassReport() {
  const { picker, subject, section } = useClassPicker();
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error, reload } = useFetch(
    '/attendance/class-report',
    { subject, section, ...(range.from && { from: range.from }), ...(range.to && { to: range.to }) },
    { enabled: !!subject }
  );
  let body;
  if (!subject) {
    body = <EmptyState icon="chart" title="Select a class" />;
  } else if (loading) {
    body = <PageLoader />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={reload} />;
  } else if (!data.rows.length) {
    body = <EmptyState title="No students" />;
  } else {
    body = (
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              <th>ID</th>
              <th>Student</th>
              <th>Present</th>
              <th>Late</th>
              <th>Absent</th>
              <th>Excused</th>
              <th style={{ minWidth: 160 }}>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.student._id}>
                <td data-label="ID">{r.student.studentId}</td>
                <td data-label="Student">
                  <strong>{fullName(r.student)}</strong>
                </td>
                <td data-label="Present">{r.present}</td>
                <td data-label="Late">{r.late}</td>
                <td data-label="Absent">{r.absent}</td>
                <td data-label="Excused">{r.excused}</td>
                <td data-label="Attendance">
                  <div className="row-between small">
                    <strong>
                      {r.percentage ?? '—'}
                      {r.percentage != null && '%'}
                    </strong>
                    {r.belowThreshold && <Badge tone="danger">Below {data.threshold}%</Badge>}
                  </div>
                  <ProgressBar value={r.percentage} threshold={data.threshold} label={`${fullName(r.student)} attendance`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card title="Class attendance report" bodyClass={null}>
      <div className="card-body">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {picker}
          <Field label="From" htmlFor="cr-from">
            <input
              id="cr-from"
              className="input"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </Field>
          <Field label="To" htmlFor="cr-to">
            <input id="cr-to" className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
        </div>
      </div>
      {body}
    </Card>
  );
}

/**
 * List of correction requests. Staff see everyone's requests (pending first) and can approve or
 * reject them; students only see their own.
 */
function Corrections({ staff }: any) {
  const defaultStatus = staff ? 'pending' : '';
  const list = useListQuery('/attendance/corrections', { limit: 10, initialFilters: { status: defaultStatus } });
  const [reviewing, setReviewing] = useState(null);

  const review = async (values) => {
    await api.patch(`/attendance/corrections/${reviewing.row._id}`, {
      status: reviewing.status,
      ...(values.reviewNote ? { reviewNote: values.reviewNote } : {}),
    });
    toast.success(`Request ${reviewing.status}`);
    setReviewing(null);
    list.reload();
  };

  return (
    <Card
      title="Attendance correction requests"
      bodyClass={null}
      actions={
        <select
          className="select"
          aria-label="Filter by status"
          value={list.filters.status || ''}
          onChange={(e) => list.setFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      }
    >
      <DataTable
        columns={[
          ...(staff ? [{ key: 'student', label: 'Student', render: (r) => `${r.student?.studentId} · ${fullName(r.student)}` }] : []),
          { key: 'subject', label: 'Subject', render: (r) => r.subject?.code },
          { key: 'date', label: 'Date', render: (r) => fmtDate(r.attendance?.date) },
          {
            key: 'change',
            label: 'Change',
            render: (r) => (
              <span>
                <Badge value={r.attendance?.status} /> → <Badge value={r.requestedStatus} />
              </span>
            ),
          },
          { key: 'reason', label: 'Reason', render: (r) => <span className="small">{r.reason}</span> },
          { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
        ]}
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        page={list.page}
        onPage={list.setPage}
        empty={<EmptyState icon="inbox" title="No correction requests" />}
        actions={
          staff
            ? (r) =>
                r.status === 'pending' && (
                  <>
                    <Button size="sm" variant="primary" onClick={() => setReviewing({ row: r, status: 'approved' })}>
                      Approve
                    </Button>{' '}
                    <Button size="sm" onClick={() => setReviewing({ row: r, status: 'rejected' })}>
                      Reject
                    </Button>
                  </>
                )
            : undefined
        }
      />
      {reviewing && (
        <Modal title={`${reviewing.status === 'approved' ? 'Approve' : 'Reject'} correction`} onClose={() => setReviewing(null)} size="sm">
          <DynamicForm
            fields={[{ name: 'reviewNote', label: 'Note to student (optional)', type: 'textarea', maxLength: 500 }]}
            onSubmit={review}
            onCancel={() => setReviewing(null)}
            submitLabel={reviewing.status === 'approved' ? 'Approve' : 'Reject'}
          />
        </Modal>
      )}
    </Card>
  );
}

/** View for students and parents: summary, daily history and correction requests. */
function StudentAttendance() {
  const { user } = useAuth();
  const isParent = user.role === 'parent';
  const kids = useFetch('/students', { limit: 50 }, { enabled: isParent });
  const [kid, setKid] = useState('');
  // Students use the special id 'me'; parents use the selected child (first child by default).
  const studentId = isParent ? kid || kids.data?.[0]?._id : 'me';
  const [tab, setTab] = useState('summary');
  const [range, setRange] = useState({ from: '', to: '', subject: '' });
  const [page, setPage] = useState(1);
  const hist = useFetch(
    `/attendance/student/${studentId}/history`,
    {
      page,
      limit: 20,
      ...(range.subject && { subject: range.subject }),
      ...(range.from && { from: range.from }),
      ...(range.to && { to: range.to }),
    },
    { enabled: !!studentId && tab === 'history' }
  );
  const summary = useFetch(`/attendance/student/${studentId}/summary`, undefined, { enabled: !!studentId });
  const [correcting, setCorrecting] = useState(null);

  // Change one filter and go back to the first page of results.
  const changeFilter = (name: string, value: string) => {
    setRange({ ...range, [name]: value });
    setPage(1);
  };

  const submitCorrection = async (v) => {
    await api.post('/attendance/corrections', { attendance: correcting._id, requestedStatus: v.requestedStatus, reason: v.reason });
    toast.success('Correction request submitted');
    setCorrecting(null);
  };

  if (isParent && kids.loading) return <PageLoader />;
  if (isParent && !kids.data?.length) return <EmptyState icon="users" title="No linked students" />;

  return (
    <div className="page">
      <PageHeader
        title="Attendance"
        subtitle="Your attendance record"
        actions={
          isParent &&
          kids.data.length > 1 && (
            <select className="select" aria-label="Select child" value={kid || kids.data[0]._id} onChange={(e) => setKid(e.target.value)}>
              {kids.data.map((c) => (
                <option key={c._id} value={c._id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'summary', label: 'Summary' },
          { value: 'history', label: 'Daily history' },
          ...(!isParent ? [{ value: 'corrections', label: 'Corrections' }] : []),
        ]}
      />
      {tab === 'summary' && <AttendanceSummaryView studentId={studentId} />}
      {tab === 'history' && (
        <Card bodyClass={null}>
          <div className="table-toolbar">
            <select
              className="select"
              aria-label="Subject"
              value={range.subject}
              onChange={(e) => changeFilter('subject', e.target.value)}
            >
              <option value="">All subjects</option>
              {summary.data?.subjects.map((s) => (
                <option key={s.subject} value={s.subject}>
                  {s.code}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 'auto' }}
              type="date"
              aria-label="From date"
              value={range.from}
              onChange={(e) => changeFilter('from', e.target.value)}
            />
            <input
              className="input"
              style={{ width: 'auto' }}
              type="date"
              aria-label="To date"
              value={range.to}
              onChange={(e) => changeFilter('to', e.target.value)}
            />
          </div>
          <DataTable
            columns={[
              { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
              { key: 'subject', label: 'Subject', render: (r) => `${r.subject?.code} · ${r.subject?.name}` },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'remarks', label: 'Remarks', render: (r) => r.remarks || '—' },
            ]}
            rows={hist.data || []}
            loading={hist.loading}
            error={hist.error}
            onRetry={hist.reload}
            meta={hist.meta}
            page={page}
            onPage={setPage}
            empty={<EmptyState icon="calendar" title="No records for this period" />}
            actions={
              !isParent
                ? (r) =>
                    r.status !== 'present' && (
                      <Button size="sm" onClick={() => setCorrecting(r)}>
                        Request correction
                      </Button>
                    )
                : undefined
            }
          />
        </Card>
      )}
      {tab === 'corrections' && <Corrections staff={false} />}
      {correcting && (
        <Modal title="Request attendance correction" onClose={() => setCorrecting(null)} size="sm">
          <Alert tone="info">
            {correcting.subject?.code} on {fmtDate(correcting.date)} is currently recorded as <strong>{correcting.status}</strong>.
          </Alert>
          <div style={{ height: 12 }} />
          <DynamicForm
            fields={[
              {
                name: 'requestedStatus',
                label: 'Should be',
                type: 'select',
                required: true,
                options: STATUS.filter((s) => s !== correcting.status).map((s) => ({ value: s, label: capitalize(s) })),
              },
              {
                name: 'reason',
                label: 'Reason',
                type: 'textarea',
                required: true,
                maxLength: 500,
                hint: 'Explain why the record is wrong (min 5 characters)',
              },
            ]}
            onSubmit={submitCorrection}
            onCancel={() => setCorrecting(null)}
            submitLabel="Submit request"
          />
        </Modal>
      )}
    </div>
  );
}

/** Staff get the three-tab view; students and parents get their own view. */
export default function Attendance() {
  const { user } = useAuth();
  const [tab, setTab] = useState('mark');
  if (user.role === 'student' || user.role === 'parent') return <StudentAttendance />;
  return (
    <div className="page">
      <PageHeader title="Attendance" subtitle="Mark attendance, review class reports and handle correction requests" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'mark', label: 'Mark attendance' },
          { value: 'report', label: 'Class report' },
          { value: 'corrections', label: 'Correction requests' },
        ]}
      />
      {tab === 'mark' && <MarkAttendance />}
      {tab === 'report' && <ClassReport />}
      {tab === 'corrections' && <Corrections staff />}
    </div>
  );
}
