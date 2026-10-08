'use client';

// Placements. Students browse job openings, apply, and track their applications.
// Admin manages jobs, companies and application statuses.
// Uses /placements/jobs, /placements/companies and /placements/applications.

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { useListQuery } from '@/hooks';
import { api, errorMessage } from '@/lib/api-client';
import DataTable from '@/components/ui/data-table';
import ResourcePage from '@/components/ui/resource-page';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Tabs } from '@/components/ui';
import { fmtDate, fmtMoney, fullName, titleCase } from '@/lib/format';

const APP_STATUS = ['applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected'].map((s) => ({
  value: s,
  label: titleCase(s),
}));

// What a student sees in the "Your status" column: application status, "Eligible", or why they cannot apply.
function JobStatus({ job }: any) {
  if (job.applicationStatus) return <Badge value={job.applicationStatus} />;
  if (job.eligible) return <Badge tone="success">Eligible</Badge>;
  return (
    <span className="small" style={{ color: 'var(--danger)' }}>
      {job.reasons?.[0]}
    </span>
  );
}

// Student tab: open jobs with an Apply button (disabled when not eligible).
function StudentJobs() {
  const list = useListQuery('/placements/jobs', { limit: 10 });
  const apply = async (j) => {
    try {
      await api.post(`/placements/jobs/${j._id}/apply`);
      toast.success(`Applied to ${j.title}`);
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card bodyClass={null}>
      <DataTable
        columns={[
          {
            key: 'title',
            label: 'Role',
            render: (j) => (
              <div>
                <strong>{j.title}</strong>
                <div className="muted small">
                  {j.company?.name}
                  {j.location ? ` · ${j.location}` : ''}
                </div>
              </div>
            ),
          },
          { key: 'package', label: 'Package', render: (j) => (j.package ? fmtMoney(j.package) : '—') },
          {
            key: 'eligibility',
            label: 'Eligibility',
            render: (j) => (
              <div className="small">
                Min CGPA {j.eligibility?.minCgpa || 0} · Max backlogs {j.eligibility?.maxActiveBacklogs ?? 0}
                {j.eligibility?.programs?.length ? ` · ${j.eligibility.programs.map((p) => p.code).join(', ')}` : ''}
              </div>
            ),
          },
          { key: 'deadline', label: 'Deadline', render: (j) => fmtDate(j.deadline) },
          {
            key: 'state',
            label: 'Your status',
            render: (j) => <JobStatus job={j} />,
          },
        ]}
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        page={list.page}
        onPage={list.setPage}
        empty={<EmptyState icon="briefcase" title="No openings right now" message="Check back later for new placement drives." />}
        actions={(j) =>
          !j.applicationStatus && (
            <Button size="sm" variant="primary" disabled={!j.eligible} onClick={() => apply(j)}>
              Apply
            </Button>
          )
        }
      />
    </Card>
  );
}

// Application list. Admin sees every student and can change the status; a student sees only their own, read only.
function Applications({ admin }: any) {
  const list = useListQuery('/placements/applications', { limit: 15 });
  const change = async (a, status) => {
    try {
      await api.patch(`/placements/applications/${a._id}/status`, { status });
      toast.success('Status updated');
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card bodyClass={null}>
      <div className="table-toolbar">
        <select
          className="select"
          aria-label="Status"
          value={list.filters.status || ''}
          onChange={(e) => list.setFilter('status', e.target.value)}
        >
          <option value="">Status: All</option>
          {APP_STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        columns={[
          ...(admin ? [{ key: 'student', label: 'Student', render: (a) => `${a.student?.studentId} · ${fullName(a.student)}` }] : []),
          { key: 'job', label: 'Role', render: (a) => `${a.job?.title} — ${a.job?.company?.name}` },
          { key: 'createdAt', label: 'Applied', sortKey: 'createdAt', render: (a) => fmtDate(a.createdAt) },
          {
            key: 'status',
            label: 'Status',
            render: (a) =>
              admin ? (
                <select className="select" aria-label="Application status" value={a.status} onChange={(e) => change(a, e.target.value)}>
                  {APP_STATUS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge value={a.status} />
              ),
          },
        ]}
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        page={list.page}
        onPage={list.setPage}
        sort={list.sort}
        onSort={list.setSort}
        empty={<EmptyState icon="briefcase" title="No applications yet" />}
      />
    </Card>
  );
}

// Settings for the generic ResourcePage (admin only): companies and job openings.
const COMPANIES = {
  title: 'Companies',
  endpoint: '/placements/companies',
  entity: 'company',
  defaultSort: 'name',
  fields: [
    { name: 'name', label: 'Company name', required: true },
    { name: 'industry', label: 'Industry' },
    { name: 'website', label: 'Website', span2: true },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
  columns: [
    { key: 'name', label: 'Name', sortKey: 'name', render: (c) => <strong>{c.name}</strong> },
    { key: 'industry', label: 'Industry', render: (c) => c.industry || '—' },
    { key: 'website', label: 'Website', render: (c) => c.website || '—' },
  ],
};

const JOBS = {
  title: 'Job openings',
  endpoint: '/placements/jobs',
  entity: 'job opening',
  createLabel: 'Add opening',
  defaultSort: '-deadline',
  modalSize: 'lg',
  defaults: { eligibility: { minCgpa: '0', maxActiveBacklogs: '0' } },
  fields: [
    { name: 'company', label: 'Company', type: 'select', required: true, optionsUrl: '/placements/companies' },
    { name: 'title', label: 'Role title', required: true },
    { name: 'location', label: 'Location' },
    { name: 'package', label: 'Package (per year)', type: 'number', min: 0 },
    { name: 'deadline', label: 'Application deadline', type: 'date', required: true },
    { name: 'eligibility.minCgpa', label: 'Minimum CGPA', type: 'number', min: 0, max: 10, step: 0.1 },
    { name: 'eligibility.maxActiveBacklogs', label: 'Max active backlogs', type: 'number', min: 0, step: 1 },
    {
      name: 'eligibility.programs',
      label: 'Eligible programs (empty = all)',
      type: 'multiselect',
      optionsUrl: '/programs',
      optionLabel: (p) => `${p.code} — ${p.name}`,
      span2: true,
    },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'isPublished', label: 'Published', type: 'checkbox', checkboxLabel: 'Publish to students' },
  ],
  columns: [
    {
      key: 'title',
      label: 'Role',
      render: (j) => (
        <div>
          <strong>{j.title}</strong>
          <div className="muted small">{j.company?.name}</div>
        </div>
      ),
    },
    { key: 'package', label: 'Package', sortKey: 'package', render: (j) => (j.package ? fmtMoney(j.package) : '—') },
    { key: 'deadline', label: 'Deadline', sortKey: 'deadline', render: (j) => fmtDate(j.deadline) },
    { key: 'minCgpa', label: 'Min CGPA', render: (j) => j.eligibility?.minCgpa || 0 },
    {
      key: 'isPublished',
      label: 'Status',
      render: (j) => <Badge tone={j.isPublished ? 'success' : 'warning'}>{j.isPublished ? 'Published' : 'Draft'}</Badge>,
    },
  ],
};

export default function Placements() {
  const { user } = useAuth();
  // Admin starts on the jobs tab, students on openings
  const [tab, setTab] = useState(user.role === 'admin' ? 'jobs' : 'openings');
  if (user.role === 'student') {
    return (
      <div className="page">
        <PageHeader title="Placements" subtitle="Browse openings, check eligibility and track your applications" />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'openings', label: 'Openings' },
            { value: 'applications', label: 'My applications' },
          ]}
        />
        {tab === 'openings' ? (
          <>
            <Alert tone="info">Eligibility uses your current CGPA, program and active status.</Alert>
            <StudentJobs />
          </>
        ) : (
          <Applications />
        )}
      </div>
    );
  }
  return (
    <div className="stack">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'jobs', label: 'Job openings' },
          { value: 'companies', label: 'Companies' },
          { value: 'applications', label: 'Applications' },
        ]}
      />
      {tab === 'jobs' && <ResourcePage key="j" {...JOBS} subtitle="Publish drives with eligibility rules" />}
      {tab === 'companies' && <ResourcePage key="c" {...COMPANIES} subtitle="Recruiting companies" />}
      {tab === 'applications' && (
        <div className="page">
          <PageHeader title="Applications" subtitle="Track candidates through the hiring pipeline" />
          <Applications admin />
        </div>
      )}
    </div>
  );
}
