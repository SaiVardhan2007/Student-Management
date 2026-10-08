'use client';

// Academic setup (admin only): tabs to manage departments, programs, academic years, semesters
// and sections. Each tab is just a config object handed to the shared ResourcePage component,
// which builds the list, create/edit form and delete. APIs: /departments, /programs,
// /academic-years, /semesters, /sections

import { useState } from 'react';
import ResourcePage from '@/components/ui/resource-page';
import { Badge, Tabs } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { SEMESTERS } from '@/lib/constants';

// Shared 'Active' checkbox field and status badge used by several tabs.
const active = { name: 'isActive', label: 'Active', type: 'checkbox', checkboxLabel: 'Active' };

function ActiveBadge({ isActive }) {
  return <Badge tone={isActive ? 'success' : 'danger'}>{isActive ? 'Active' : 'Inactive'}</Badge>;
}

const DEPARTMENTS = {
  title: 'Departments',
  subtitle: 'Departments are fully configurable — nothing is hard-coded.',
  endpoint: '/departments',
  entity: 'department',
  defaultSort: 'name',
  defaults: { isActive: true },
  fields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'code', label: 'Code', required: true, maxLength: 12, hint: 'Short unique code, e.g. CSE' },
    { name: 'description', label: 'Description', type: 'textarea' },
    {
      name: 'head',
      label: 'Head of department',
      type: 'select',
      optionsUrl: '/faculty',
      optionLabel: (f) => `${f.firstName} ${f.lastName}`,
    },
    active,
  ],
  columns: [
    { key: 'code', label: 'Code', sortKey: 'code', render: (r) => <strong>{r.code}</strong> },
    { key: 'name', label: 'Name', sortKey: 'name' },
    { key: 'head', label: 'Head', render: (r) => (r.head ? `${r.head.firstName} ${r.head.lastName}` : '—') },
    {
      key: 'isActive',
      label: 'Status',
      render: (r) => <ActiveBadge isActive={r.isActive} />,
    },
  ],
};

const PROGRAMS = {
  title: 'Programs',
  subtitle: 'Degree programs offered by each department',
  endpoint: '/programs',
  entity: 'program',
  defaultSort: 'name',
  defaults: { durationYears: '4', totalSemesters: '8', isActive: true },
  filters: [{ name: 'department', label: 'Department', optionsUrl: '/departments' }],
  fields: [
    { name: 'name', label: 'Program name', required: true },
    { name: 'code', label: 'Code', required: true, maxLength: 20 },
    { name: 'department', label: 'Department', type: 'select', required: true, optionsUrl: '/departments' },
    { name: 'durationYears', label: 'Duration (years)', type: 'number', min: 1, max: 8, required: true },
    { name: 'totalSemesters', label: 'Total semesters', type: 'number', min: 1, max: 16, required: true },
    active,
  ],
  columns: [
    { key: 'code', label: 'Code', sortKey: 'code', render: (r) => <strong>{r.code}</strong> },
    { key: 'name', label: 'Name', sortKey: 'name' },
    { key: 'department', label: 'Department', render: (r) => r.department?.name || '—' },
    { key: 'durationYears', label: 'Years' },
    { key: 'totalSemesters', label: 'Semesters' },
    {
      key: 'isActive',
      label: 'Status',
      render: (r) => <ActiveBadge isActive={r.isActive} />,
    },
  ],
};

const YEARS = {
  title: 'Academic years',
  subtitle: 'Only one academic year can be marked as current.',
  endpoint: '/academic-years',
  entity: 'academic year',
  defaultSort: '-startDate',
  fields: [
    { name: 'name', label: 'Name', required: true, placeholder: '2025-26' },
    { name: 'startDate', label: 'Start date', type: 'date', required: true },
    { name: 'endDate', label: 'End date', type: 'date', required: true },
    { name: 'isCurrent', label: 'Current', type: 'checkbox', checkboxLabel: 'This is the current academic year' },
  ],
  columns: [
    { key: 'name', label: 'Year', sortKey: 'name', render: (r) => <strong>{r.name}</strong> },
    { key: 'startDate', label: 'Starts', sortKey: 'startDate', render: (r) => fmtDate(r.startDate) },
    { key: 'endDate', label: 'Ends', render: (r) => fmtDate(r.endDate) },
    { key: 'isCurrent', label: 'Current', render: (r) => (r.isCurrent ? <Badge tone="success">Current</Badge> : '—') },
  ],
};

const SEMESTER_CFG = {
  title: 'Semesters',
  subtitle: 'Terms within an academic year',
  endpoint: '/semesters',
  entity: 'semester',
  defaultSort: '-startDate',
  filters: [{ name: 'academicYear', label: 'Year', optionsUrl: '/academic-years' }],
  fields: [
    { name: 'name', label: 'Name', required: true, placeholder: 'Even Semester' },
    { name: 'number', label: 'Semester number', type: 'number', min: 1, max: 12, required: true },
    { name: 'academicYear', label: 'Academic year', type: 'select', required: true, optionsUrl: '/academic-years' },
    { name: 'startDate', label: 'Start date', type: 'date', required: true },
    { name: 'endDate', label: 'End date', type: 'date', required: true },
    { name: 'isCurrent', label: 'Current', type: 'checkbox', checkboxLabel: 'This is the current semester' },
  ],
  columns: [
    { key: 'name', label: 'Semester', render: (r) => <strong>{r.name}</strong> },
    { key: 'number', label: 'No.', sortKey: 'number' },
    { key: 'academicYear', label: 'Year', render: (r) => r.academicYear?.name || '—' },
    { key: 'startDate', label: 'Starts', render: (r) => fmtDate(r.startDate) },
    { key: 'endDate', label: 'Ends', render: (r) => fmtDate(r.endDate) },
    { key: 'isCurrent', label: 'Current', render: (r) => (r.isCurrent ? <Badge tone="success">Current</Badge> : '—') },
  ],
};

const SECTIONS = {
  title: 'Sections',
  subtitle: 'Class sections per program, batch and semester',
  endpoint: '/sections',
  entity: 'section',
  defaultSort: 'name',
  defaults: { capacity: '60', isActive: true },
  filters: [
    { name: 'program', label: 'Program', optionsUrl: '/programs' },
    { name: 'semester', label: 'Semester', options: SEMESTERS },
  ],
  fields: [
    { name: 'name', label: 'Section name', required: true, placeholder: 'A' },
    { name: 'department', label: 'Department', type: 'select', required: true, optionsUrl: '/departments' },
    {
      name: 'program',
      label: 'Program',
      type: 'select',
      required: true,
      optionsUrl: '/programs',
      // Only show programs that belong to the department chosen above.
      filterOptions: (o, v) => (v.department ? o.filter((x) => (x.raw.department?._id || x.raw.department) === v.department) : o),
    },
    { name: 'batch', label: 'Batch', placeholder: '2025' },
    { name: 'semester', label: 'Semester', type: 'select', options: SEMESTERS, required: true },
    { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 500 },
    active,
  ],
  columns: [
    { key: 'name', label: 'Section', sortKey: 'name', render: (r) => <strong>{r.name}</strong> },
    { key: 'program', label: 'Program', render: (r) => r.program?.code || '—' },
    { key: 'batch', label: 'Batch' },
    { key: 'semester', label: 'Sem', sortKey: 'semester' },
    { key: 'capacity', label: 'Capacity' },
    {
      key: 'isActive',
      label: 'Status',
      render: (r) => <ActiveBadge isActive={r.isActive} />,
    },
  ],
};

const TABS = [
  { value: 'departments', label: 'Departments', cfg: DEPARTMENTS },
  { value: 'programs', label: 'Programs', cfg: PROGRAMS },
  { value: 'years', label: 'Academic years', cfg: YEARS },
  { value: 'semesters', label: 'Semesters', cfg: SEMESTER_CFG },
  { value: 'sections', label: 'Sections', cfg: SECTIONS },
];

export default function AcademicSetup() {
  const [tab, setTab] = useState('departments');
  const current = TABS.find((t) => t.value === tab);
  return (
    <div className="stack">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {/* key makes React reset the page state when the tab changes */}
      <ResourcePage key={tab} {...current.cfg} />
    </div>
  );
}
