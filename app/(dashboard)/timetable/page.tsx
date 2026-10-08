'use client';

// Timetable. Admin manages class slots (the server rejects faculty, room and section clashes).
// Faculty, students and parents see a read-only weekly view. Uses /timetable and /timetable/me.

import { useAuth } from '@/components/providers/auth-provider';
import { useFetch } from '@/hooks';
import ResourcePage from '@/components/ui/resource-page';
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/ui';
import { titleCase, fullName } from '@/lib/format';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => ({ value: d, label: titleCase(d) }));

// Read-only weekly view for students, parents and faculty.
function MyTimetable() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/timetable/me');
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  // Group the slots by day name, e.g. { monday: [...], tuesday: [...] }
  const byDay = Object.fromEntries(DAYS.map((d) => [d.value, data.filter((s) => s.day === d.value)]));
  // Weekends are hidden unless they have classes
  const days = DAYS.filter((d) => byDay[d.value].length || !['saturday', 'sunday'].includes(d.value));
  return (
    <div className="page">
      <PageHeader title="Timetable" subtitle={user.role === 'faculty' ? 'Your teaching schedule' : 'Your weekly class schedule'} />
      {!data.length ? (
        <Card>
          <EmptyState icon="clock" title="No classes scheduled" message="The timetable has not been published for you yet." />
        </Card>
      ) : (
        <div className="tt-grid">
          {days.map((d) => (
            <Card key={d.value} title={d.label}>
              {!byDay[d.value].length ? (
                <p className="faint small">No classes</p>
              ) : (
                byDay[d.value].map((s) => (
                  <div key={s._id} className="tt-slot">
                    <div className="strong">
                      {s.startTime} – {s.endTime}
                    </div>
                    <div>
                      {s.subject?.code} · {s.subject?.name}
                    </div>
                    {/* Faculty need the section; students and parents need the teacher */}
                    <div className="small muted">
                      {s.room}
                      {user.role === 'faculty' ? ` · Section ${s.section?.name}` : ` · ${s.faculty ? fullName(s.faculty) : ''}`}
                    </div>
                  </div>
                ))
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const FIELDS = [
  { name: 'day', label: 'Day', type: 'select', options: DAYS, required: true },
  { name: 'startTime', label: 'Start time', type: 'time', required: true },
  { name: 'endTime', label: 'End time', type: 'time', required: true },
  {
    name: 'section',
    label: 'Section',
    type: 'select',
    required: true,
    optionsUrl: '/sections',
    optionLabel: (s) => `${s.program?.code || ''} · ${s.name}${s.batch ? ` (${s.batch})` : ''} · Sem ${s.semester}`,
  },
  {
    name: 'subject',
    label: 'Subject',
    type: 'select',
    required: true,
    optionsUrl: '/subjects',
    optionLabel: (s) => `${s.code} — ${s.name}`,
  },
  {
    name: 'faculty',
    label: 'Faculty',
    type: 'select',
    required: true,
    optionsUrl: '/faculty',
    optionLabel: (f) => `${f.firstName} ${f.lastName}`,
  },
  { name: 'room', label: 'Room', required: true, maxLength: 60 },
];

export default function Timetable() {
  const { user } = useAuth();
  if (user.role !== 'admin') return <MyTimetable />;
  return (
    <ResourcePage
      title="Timetable"
      subtitle="Slots are checked for faculty, room and section conflicts before saving."
      endpoint="/timetable"
      entity="timetable slot"
      createLabel="Add slot"
      fields={FIELDS}
      defaults={{ day: 'monday' }}
      defaultSort="startTime"
      limit={20}
      filters={[
        { name: 'day', label: 'Day', options: DAYS },
        { name: 'section', label: 'Section', optionsUrl: '/sections', optionLabel: (s) => `${s.program?.code} ${s.name} S${s.semester}` },
        { name: 'faculty', label: 'Faculty', optionsUrl: '/faculty', optionLabel: (f) => `${f.firstName} ${f.lastName}` },
      ]}
      columns={[
        { key: 'day', label: 'Day', sortKey: 'day', render: (r) => <Badge tone="primary">{r.day}</Badge> },
        { key: 'time', label: 'Time', sortKey: 'startTime', render: (r) => `${r.startTime} – ${r.endTime}` },
        { key: 'subject', label: 'Subject', render: (r) => `${r.subject?.code || ''} ${r.subject?.name || ''}` },
        { key: 'faculty', label: 'Faculty', render: (r) => (r.faculty ? fullName(r.faculty) : '—') },
        { key: 'section', label: 'Section', render: (r) => r.section?.name || '—' },
        { key: 'room', label: 'Room' },
      ]}
    />
  );
}
