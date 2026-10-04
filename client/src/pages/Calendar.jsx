import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from '../hooks/index.js';
import ResourcePage from '../components/ResourcePage.jsx';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader } from '../components/ui.jsx';

const TYPES = ['exam', 'holiday', 'assignment', 'seminar', 'event', 'deadline'].map((t) => ({
  value: t,
  label: t[0].toUpperCase() + t.slice(1),
}));
const AUDIENCE = [
  { value: 'all', label: 'Everyone' },
  { value: 'students', label: 'Students' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'parents', label: 'Parents' },
];
const TONE = { exam: 'danger', holiday: 'success', assignment: 'warning', seminar: 'info', event: 'primary', deadline: 'warning' };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Agenda() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const from = ymd(month);
  const to = ymd(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const { data, loading, error, reload } = useFetch('/calendar', { from, to, limit: 100, sort: 'startDate' });
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <Card
      title={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      actions={
        <>
          <Button size="sm" icon="chevronLeft" aria-label="Previous month" onClick={() => shift(-1)} />
          <Button size="sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Today
          </Button>
          <Button size="sm" icon="chevronRight" aria-label="Next month" onClick={() => shift(1)} />
        </>
      }
    >
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data.length ? (
        <EmptyState icon="calendar" title="No events this month" />
      ) : (
        data.map((e) => {
          const d = new Date(e.startDate);
          return (
            <div key={e._id} className="calendar-day">
              <div className="calendar-date">
                <div className="d">{d.getUTCDate()}</div>
                <div className="m">{d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</div>
              </div>
              <div className="grow">
                <div className="strong">{e.title}</div>
                {e.description && <div className="muted small">{e.description}</div>}
                {e.endDate && (
                  <div className="faint small">Until {new Date(e.endDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}</div>
                )}
              </div>
              <Badge tone={TONE[e.type]}>{e.type}</Badge>
            </div>
          );
        })
      )}
    </Card>
  );
}

export default function Calendar() {
  const { user } = useAuth();
  if (user.role !== 'admin')
    return (
      <div className="page">
        <PageHeader title="Academic calendar" subtitle="Exams, holidays, deadlines and events" />
        <Agenda />
      </div>
    );
  return (
    <ResourcePage
      title="Academic calendar"
      subtitle="Events are visible to the selected audience."
      endpoint="/calendar"
      entity="event"
      createLabel="Add event"
      defaultSort="startDate"
      defaults={{ type: 'event', audience: 'all' }}
      filters={[{ name: 'type', label: 'Type', options: TYPES }]}
      fields={[
        { name: 'title', label: 'Title', required: true, span2: true },
        { name: 'type', label: 'Type', type: 'select', options: TYPES, required: true },
        { name: 'audience', label: 'Audience', type: 'select', options: AUDIENCE, required: true },
        { name: 'startDate', label: 'Start date', type: 'date', required: true },
        { name: 'endDate', label: 'End date', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
      columns={[
        {
          key: 'startDate',
          label: 'Date',
          sortKey: 'startDate',
          render: (r) =>
            new Date(r.startDate).toLocaleDateString(undefined, { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }),
        },
        { key: 'title', label: 'Title', sortKey: 'title' },
        { key: 'type', label: 'Type', render: (r) => <Badge tone={TONE[r.type]}>{r.type}</Badge> },
        { key: 'audience', label: 'Audience', render: (r) => <Badge>{r.audience}</Badge> },
      ]}
    />
  );
}
