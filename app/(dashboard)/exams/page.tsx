'use client';

// Exam schedule. Admin creates/edits/deletes exams, publishes them and can generate seating.
// Students see published exams and can look up their own seat. API: /exams

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/components/providers/auth-provider';
import ResourcePage from '@/components/ui/resource-page';
import { Badge, Button } from '@/components/ui';
import { RowAction } from '@/components/ui/data-table';
import { useConfirm } from '@/components/providers/confirm-provider';
import { api, errorMessage } from '@/lib/api-client';
import { fmtDate } from '@/lib/format';
import { SEMESTERS } from '@/lib/constants';

const TYPES = ['internal', 'mid', 'final', 'practical'].map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }));

/** Student's seat is fetched on demand, only when the button is clicked. */
function SeatCell({ exam }: any) {
  // undefined = not loaded yet, '' / null = loaded but no seat assigned
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
    const ok = await confirm({
      title: 'Generate seating?',
      message: `Assign seats to all students enrolled in ${exam.subject?.code}. Any existing arrangement is replaced.`,
      confirmLabel: 'Generate',
    });
    if (!ok) return;
    // rooms are free text, so ask how many seats one room holds; extra rooms are used when the class is larger
    const answer = window.prompt('Seats per room (leave blank for no limit; larger classes are split across rooms)', '');
    if (answer === null) return;
    const capacity = Number(answer);
    if (answer.trim() && (!Number.isInteger(capacity) || capacity < 1)) return void toast.error('Enter a whole number of seats, or leave blank.');
    try {
      const r = await api.post(`/exams/${exam._id}/seating`, answer.trim() ? { perRoomCapacity: capacity } : {});
      toast.success(r.data.message);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // Only admin can create or edit exams, so other roles get no form fields.
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
