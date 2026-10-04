import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import ResourcePage from '../components/ResourcePage.jsx';
import { Badge, Button } from '../components/ui.jsx';
import { RowAction } from '../components/DataTable.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { api, errorMessage } from '../api/client.js';
import { fmtDate } from '../utils/format.js';
import { SEMESTERS } from './Students.jsx';

const TYPES = ['internal', 'mid', 'final', 'practical'].map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }));

function SeatCell({ exam }) {
  const [seat, setSeat] = useState(undefined);
  const load = async () => {
    try {
      const r = await api.get(`/exams/${exam._id}/my-seat`);
      setSeat(r.data.data.seat);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return seat === undefined ? (
    <Button size="sm" onClick={load}>
      Show seat
    </Button>
  ) : (
    <span>{seat || <span className="faint">Not assigned</span>}</span>
  );
}

export default function Exams() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const confirm = useConfirm();

  const seating = async (exam) => {
    if (
      !(await confirm({
        title: 'Generate seating?',
        message: `Assign seats to all students enrolled in ${exam.subject?.code}. Any existing arrangement is replaced.`,
        confirmLabel: 'Generate',
      }))
    )
      return;
    try {
      const r = await api.post(`/exams/${exam._id}/seating`, {});
      toast.success(r.data.message);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const fields = isAdmin
    ? [
        { name: 'name', label: 'Exam name', required: true, span2: true },
        { name: 'type', label: 'Type', type: 'select', options: TYPES, required: true },
        {
          name: 'subject',
          label: 'Subject',
          type: 'select',
          required: true,
          optionsUrl: '/subjects',
          optionLabel: (s) => `${s.code} — ${s.name}`,
        },
        { name: 'program', label: 'Program', type: 'select', required: true, optionsUrl: '/programs' },
        { name: 'semester', label: 'Semester', type: 'select', required: true, options: SEMESTERS },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'startTime', label: 'Start time', type: 'time', required: true },
        { name: 'endTime', label: 'End time', type: 'time', required: true },
        { name: 'room', label: 'Room / hall' },
        { name: 'maxMarks', label: 'Maximum marks', type: 'number', min: 1, max: 1000 },
        {
          name: 'invigilators',
          label: 'Invigilators',
          type: 'multiselect',
          optionsUrl: '/faculty',
          optionLabel: (f) => `${f.firstName} ${f.lastName}`,
          span2: true,
          hint: 'Hold Ctrl/Cmd to select several',
        },
        { name: 'isPublished', label: 'Published', type: 'checkbox', checkboxLabel: 'Publish to students (sends notifications)' },
      ]
    : [];

  return (
    <ResourcePage
      title="Examinations"
      subtitle={isAdmin ? 'Create and publish the examination schedule. Room clashes are blocked.' : 'Published examination schedule'}
      endpoint="/exams"
      entity="exam"
      createLabel="Schedule exam"
      fields={fields}
      defaultSort="date"
      defaults={{ type: 'mid', maxMarks: '100' }}
      modalSize="lg"
      canCreate={isAdmin}
      canEdit={() => isAdmin}
      canDelete={() => isAdmin}
      filters={
        isAdmin
          ? [
              { name: 'type', label: 'Type', options: TYPES },
              { name: 'semester', label: 'Semester', options: SEMESTERS },
              {
                name: 'isPublished',
                label: 'Status',
                options: [
                  { value: 'true', label: 'Published' },
                  { value: 'false', label: 'Draft' },
                ],
              },
            ]
          : [{ name: 'type', label: 'Type', options: TYPES }]
      }
      columns={[
        { key: 'date', label: 'Date', sortKey: 'date', render: (r) => <strong>{fmtDate(r.date)}</strong> },
        { key: 'time', label: 'Time', render: (r) => `${r.startTime} – ${r.endTime}` },
        { key: 'name', label: 'Exam', sortKey: 'name' },
        { key: 'subject', label: 'Subject', render: (r) => r.subject?.code || '—' },
        { key: 'room', label: 'Room', render: (r) => r.room || '—' },
        ...(isAdmin
          ? [
              {
                key: 'isPublished',
                label: 'Status',
                render: (r) => <Badge tone={r.isPublished ? 'success' : 'warning'}>{r.isPublished ? 'Published' : 'Draft'}</Badge>,
              },
            ]
          : []),
        ...(user.role === 'student' ? [{ key: 'seat', label: 'Seat', render: (r) => <SeatCell exam={r} /> }] : []),
      ]}
      rowActions={isAdmin ? (r) => <RowAction icon="grid" label="Generate seating arrangement" onClick={() => seating(r)} /> : undefined}
    />
  );
}
