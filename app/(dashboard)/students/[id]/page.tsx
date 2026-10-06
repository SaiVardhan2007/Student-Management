'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useFetch } from '@/hooks';
import { Avatar, Badge, Button, Card, ErrorState, PageHeader, PageLoader, Tabs } from '@/components/ui';
import { fmtDate, fullName, titleCase } from '@/lib/format';

import { AttendanceSummaryView, ResultsView } from '@/components/students/student-views';

export default function StudentDetail() {
  const { id } = useParams();
  const router = useRouter();
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
        title={
          <span className="row">
            <Avatar name={fullName(s)} size="lg" />{' '}
            <span>
              {fullName(s)}
              <br />
              <span className="muted small">
                {s.studentId} · <Badge value={s.status} />
              </span>
            </span>
          </span>
        }
        actions={
          <Button icon="chevronLeft" onClick={() => router.back()}>
            Back
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'attendance', label: 'Attendance' },
          { value: 'results', label: 'Results' },
          { value: 'subjects', label: 'Subjects' },
        ]}
      />
      {tab === 'profile' && (
        <div className="grid grid-2">
          <Card title="Personal">
            <dl className="kv">
              {[
                ...row('Email', s.email),
                ...row('Phone', s.phone),
                ...row('Date of birth', fmtDate(s.dateOfBirth)),
                ...row('Gender', titleCase(s.gender || '')),
                ...row('Address', addr),
              ]}
            </dl>
          </Card>
          <Card title="Academic">
            <dl className="kv">
              {[
                ...row('Department', s.department?.name),
                ...row('Program', s.program?.name),
                ...row('Semester', s.semester),
                ...row('Section', s.section?.name),
                ...row('Batch', s.batch),
                ...row('Admission', `${s.admissionYear || ''} ${s.admissionDate ? `(${fmtDate(s.admissionDate)})` : ''}`),
              ]}
            </dl>
          </Card>
          <Card title="Guardian">
            <dl className="kv">
              {[
                ...row('Name', s.guardian?.name),
                ...row('Relation', s.guardian?.relation),
                ...row('Phone', s.guardian?.phone),
                ...row('Email', s.guardian?.email),
              ]}
            </dl>
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
          {enroll.loading ? (
            <PageLoader />
          ) : enroll.error ? (
            <ErrorState message={enroll.error} onRetry={enroll.reload} />
          ) : !enroll.data.length ? (
            <p className="muted" style={{ padding: 16 }}>
              Not enrolled in any subject.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Credits</th>
                    <th>Faculty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {enroll.data.map(
                    (e) =>
                      e.subject && (
                        <tr key={e._id}>
                          <td data-label="Code">{e.subject.code}</td>
                          <td data-label="Subject">{e.subject.name}</td>
                          <td data-label="Type">{titleCase(e.subject.type)}</td>
                          <td data-label="Credits">{e.subject.credits}</td>
                          <td data-label="Faculty">{e.subject.faculty ? fullName(e.subject.faculty) : '—'}</td>
                          <td data-label="Status">
                            <Badge value={e.status} />
                          </td>
                        </tr>
                      )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
