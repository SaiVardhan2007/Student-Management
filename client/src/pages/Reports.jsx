import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { useDebounce, useFetch } from '../hooks/index.js';
import { downloadFrom, errorMessage } from '../api/client.js';
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, TableSkeleton, Tabs } from '../components/ui.jsx';
import { Pagination } from '../components/DataTable.jsx';
import { SEMESTERS, STATUSES } from './Students.jsx';

const sel = (label, name, options) => ({ label, name, type: 'select', options });
const REPORTS = {
  students: { label: 'Students', filters: [sel('Status', 'status', STATUSES), sel('Semester', 'semester', SEMESTERS), { label: 'Department', name: 'department', type: 'select', url: '/departments' }, { label: 'Program', name: 'program', type: 'select', url: '/programs' }], dates: 'Registered between', admin: true },
  attendance: { label: 'Attendance', filters: [{ label: 'Subject', name: 'subject', type: 'select', url: '/subjects', mine: true, code: true }, sel('Threshold', 'belowThreshold', [{ value: 'true', label: 'Below threshold only' }])], dates: 'Session dates' },
  marks: { label: 'Marks', filters: [{ label: 'Subject', name: 'subject', type: 'select', url: '/subjects', mine: true, code: true }, sel('Component', 'examType', ['assignment', 'quiz', 'internal', 'practical', 'mid', 'final'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))), sel('Semester', 'semester', SEMESTERS)], dates: 'Updated between' },
  results: { label: 'Results', filters: [sel('Semester', 'semester', SEMESTERS), { label: 'Department', name: 'department', type: 'select', url: '/departments' }, { label: 'Program', name: 'program', type: 'select', url: '/programs' }], admin: true },
  faculty: { label: 'Faculty', filters: [sel('Status', 'status', [{ value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On leave' }, { value: 'inactive', label: 'Inactive' }]), { label: 'Department', name: 'department', type: 'select', url: '/departments' }], admin: true },
  fees: { label: 'Fees', filters: [sel('Status', 'status', ['pending', 'partial', 'paid', 'overdue'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })))], dates: 'Due between', admin: true },
  placements: { label: 'Placements', filters: [sel('Status', 'status', ['applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })))], dates: 'Applied between', admin: true },
  complaints: { label: 'Complaints', filters: [sel('Status', 'status', ['open', 'assigned', 'in_progress', 'resolved', 'closed'].map((v) => ({ value: v, label: v.replace('_', ' ') }))), sel('Priority', 'priority', ['low', 'medium', 'high'].map((v) => ({ value: v, label: v })))], dates: 'Created between', admin: true },
};

function FilterControl({ f, value, onChange }) {
  const remote = useFetch(f.url || null, { limit: 100, ...(f.mine ? { mine: 'true' } : {}) }, { enabled: !!f.url });
  const options = f.url ? (remote.data || []).map((o) => ({ value: o._id, label: f.code ? o.code : o.name })) : f.options;
  return (
    <Field label={f.label} htmlFor={`rf-${f.name}`}>
      <select id={`rf-${f.name}`} className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">All</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </Field>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const types = Object.entries(REPORTS).filter(([, r]) => isAdmin || !r.admin);
  const [type, setType] = useState(types[0][0]);
  const [filters, setFilters] = useState({});
  const [range, setRange] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const debounced = useDebounce(search);

  const cfg = REPORTS[type];
  const params = useMemo(() => ({ ...Object.fromEntries(Object.entries({ ...filters, ...range, search: debounced }).filter(([, v]) => v)), page, limit: 25 }), [filters, range, debounced, page]);
  const { data, meta, loading, error, reload } = useFetch(`/reports/${type}`, params);

  const change = (t) => { setType(t); setFilters({}); setRange({ from: '', to: '' }); setSearch(''); setPage(1); };
  const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const download = async (format) => {
    setBusy(format);
    try {
      const { page: _p, limit: _l, ...rest } = params;
      await downloadFrom(`/reports/${type}`, { ...rest, format }, `${type}-report.${format}`);
    } catch (e) { toast.error(errorMessage(e, 'Unable to generate the report.')); } finally { setBusy(''); }
  };

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Filter, review and export data" actions={<><Button icon="download" loading={busy === 'csv'} onClick={() => download('csv')}>Export CSV</Button><Button icon="download" loading={busy === 'pdf'} onClick={() => download('pdf')}>Export PDF</Button></>} />
      <Tabs value={type} onChange={change} tabs={types.map(([value, r]) => ({ value, label: r.label }))} />
      <Card>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Field label="Search" htmlFor="rf-search"><input id="rf-search" className="input" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or ID…" /></Field>
          {cfg.filters.map((f) => <FilterControl key={`${type}-${f.name}`} f={f} value={filters[f.name]} onChange={(v) => setF(f.name, v)} />)}
          {cfg.dates && (<>
            <Field label={`${cfg.dates} — from`} htmlFor="rf-from"><input id="rf-from" className="input" type="date" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1); }} /></Field>
            <Field label="to" htmlFor="rf-to"><input id="rf-to" className="input" type="date" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1); }} /></Field>
          </>)}
        </div>
      </Card>
      <Card bodyClass={null}>
        {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton cols={6} /> : !data?.rows.length ? <EmptyState icon="chart" title="No data for these filters" /> : (
          <div style={{ opacity: loading ? 0.6 : 1 }}>
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c} data-label={c}>{r[c] instanceof Object || r[c] == null ? '—' : String(/^\d{4}-\d{2}-\d{2}T/.test(r[c]) ? r[c].slice(0, 10) : r[c])}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <Pagination meta={meta} page={page} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}
