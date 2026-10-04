import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch, useListQuery } from '../hooks/index.js';
import { api, errorMessage } from '../api/client.js';
import DataTable, { RowAction } from '../components/DataTable.jsx';
import DynamicForm from '../components/DynamicForm.jsx';
import ResourcePage from '../components/ResourcePage.jsx';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, StatCard, Tabs } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { fmtDate, fmtMoney, fullName, titleCase } from '../utils/format.js';
import { SEMESTERS } from './Students.jsx';

const STATUSES = ['pending', 'partial', 'paid', 'overdue'].map((s) => ({ value: s, label: titleCase(s) }));

function Receipt({ fee, receiptNo, onClose }) {
  const { data } = useFetch(`/fees/${fee._id}/receipt/${receiptNo}`);
  return (
    <Modal
      title="Payment receipt"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={() => window.print()}>Print</Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {!data ? (
        <p>Loading…</p>
      ) : (
        <dl className="kv">
          <dt>Receipt no.</dt>
          <dd>
            <strong>{data.receiptNo}</strong>
          </dd>
          <dt>Student</dt>
          <dd>
            {fullName(data.student)} ({data.student?.studentId})
          </dd>
          <dt>Fee</dt>
          <dd>{data.fee}</dd>
          <dt>Amount paid</dt>
          <dd>{fmtMoney(data.amount)}</dd>
          <dt>Method</dt>
          <dd>{titleCase(data.method)}</dd>
          <dt>Date</dt>
          <dd>{fmtDate(data.paidAt)}</dd>
          <dt>Total due / paid</dt>
          <dd>
            {fmtMoney(data.amountDue)} / {fmtMoney(data.amountPaid)}
          </dd>
        </dl>
      )}
    </Modal>
  );
}

function Records() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const list = useListQuery('/fees', { limit: 15 });
  const [pay, setPay] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const pending = list.items.reduce((a, f) => a + f.amountPending, 0);
  const paid = list.items.reduce((a, f) => a + f.amountPaid, 0);

  return (
    <div className="stack">
      {!isAdmin && (
        <div className="grid grid-stats">
          <StatCard label="Total paid" value={fmtMoney(paid)} />
          <StatCard label="Outstanding" value={fmtMoney(pending)} tone={pending ? 'warn' : ''} />
        </div>
      )}
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <select
            className="select"
            aria-label="Status"
            value={list.filters.status || ''}
            onChange={(e) => list.setFilter('status', e.target.value)}
          >
            <option value="">Status: All</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          columns={[
            ...(isAdmin || user.role === 'parent'
              ? [{ key: 'student', label: 'Student', render: (f) => `${f.student?.studentId} · ${fullName(f.student)}` }]
              : []),
            { key: 'title', label: 'Fee', render: (f) => <strong>{f.title}</strong> },
            { key: 'amountDue', label: 'Amount', sortKey: 'amountDue', render: (f) => fmtMoney(f.amountDue) },
            { key: 'amountPaid', label: 'Paid', render: (f) => fmtMoney(f.amountPaid) },
            { key: 'amountPending', label: 'Pending', render: (f) => fmtMoney(f.amountPending) },
            { key: 'dueDate', label: 'Due', sortKey: 'dueDate', render: (f) => fmtDate(f.dueDate) },
            { key: 'status', label: 'Status', render: (f) => <Badge value={f.status} /> },
            {
              key: 'receipts',
              label: 'Receipts',
              render: (f) =>
                f.payments?.length
                  ? f.payments.map((p) => (
                      <Button key={p.receiptNo} size="sm" variant="ghost" onClick={() => setReceipt({ fee: f, no: p.receiptNo })}>
                        {p.receiptNo.slice(-6)}
                      </Button>
                    ))
                  : '—',
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
          empty={<EmptyState icon="dollar" title="No fee records" />}
          actions={
            user.role !== 'parent'
              ? (f) =>
                  f.amountPending > 0 && (
                    <Button size="sm" variant="primary" onClick={() => setPay(f)}>
                      {isAdmin ? 'Record payment' : 'Pay now'}
                    </Button>
                  )
              : undefined
          }
        />
      </Card>
      {pay && (
        <Modal title={isAdmin ? 'Record payment' : 'Pay fee'} onClose={() => setPay(null)} size="sm">
          {!isAdmin && (
            <Alert tone="info">
              This is a <strong>simulated</strong> payment for the college project — no real money moves.
            </Alert>
          )}
          <div style={{ height: 10 }} />
          <p className="small muted">
            {pay.title} · pending {fmtMoney(pay.amountPending)}
          </p>
          <DynamicForm
            initial={{ amount: String(pay.amountPending), method: isAdmin ? 'cash' : 'simulated' }}
            submitLabel={isAdmin ? 'Record' : 'Pay'}
            busyLabel="Processing…"
            onCancel={() => setPay(null)}
            onSubmit={async (v) => {
              const r = await api.post(`/fees/${pay._id}/pay`, { amount: Number(v.amount), method: v.method });
              toast.success(`Payment recorded — receipt ${r.data.data.receiptNo}`);
              setPay(null);
              list.reload();
            }}
            fields={[
              { name: 'amount', label: 'Amount', type: 'number', min: 1, max: pay.amountPending, step: 0.01, required: true, span2: true },
              ...(isAdmin
                ? [
                    {
                      name: 'method',
                      label: 'Method',
                      type: 'select',
                      required: true,
                      span2: true,
                      options: ['cash', 'card', 'upi', 'netbanking'].map((m) => ({ value: m, label: titleCase(m) })),
                    },
                  ]
                : []),
            ]}
          />
        </Modal>
      )}
      {receipt && <Receipt fee={receipt.fee} receiptNo={receipt.no} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Structures() {
  const confirm = useConfirm();
  const assign = async (s) => {
    if (
      !(await confirm({
        title: 'Assign fee to students?',
        message: `Create a fee record of ${fmtMoney(s.amount)} for every active student in ${s.program?.code} semester ${s.semester}. Existing records are left untouched.`,
        confirmLabel: 'Assign',
      }))
    )
      return;
    try {
      const r = await api.post(`/fees/structures/${s._id}/assign`);
      toast.success(`${r.data.data.created} new fee record(s) created`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <ResourcePage
      title="Fee structures"
      subtitle="Define fees per program and semester, then assign them to students."
      endpoint="/fees/structures"
      entity="fee structure"
      createLabel="New fee structure"
      defaultSort="-dueDate"
      fields={[
        { name: 'name', label: 'Name', required: true, span2: true },
        { name: 'program', label: 'Program', type: 'select', optionsUrl: '/programs', required: true },
        { name: 'semester', label: 'Semester', type: 'select', options: SEMESTERS, required: true },
        { name: 'amount', label: 'Amount', type: 'number', min: 1, required: true },
        { name: 'dueDate', label: 'Due date', type: 'date', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
      canEdit={() => false}
      deleteMessage={() => 'Delete this fee structure and all unpaid fee records generated from it?'}
      columns={[
        { key: 'name', label: 'Name', render: (s) => <strong>{s.name}</strong> },
        { key: 'program', label: 'Program', render: (s) => s.program?.code },
        { key: 'semester', label: 'Sem' },
        { key: 'amount', label: 'Amount', sortKey: 'amount', render: (s) => fmtMoney(s.amount) },
        { key: 'dueDate', label: 'Due', sortKey: 'dueDate', render: (s) => fmtDate(s.dueDate) },
      ]}
      rowActions={(s) => <RowAction icon="users" label="Assign to students" onClick={() => assign(s)} />}
    />
  );
}

export default function Fees() {
  const { user } = useAuth();
  const [tab, setTab] = useState('records');
  return (
    <div className="page">
      <PageHeader title="Fees" subtitle="Fee dues, payments and receipts (payments are simulated — no payment gateway is connected)" />
      {user.role === 'admin' && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'records', label: 'Student fees' },
            { value: 'structures', label: 'Fee structures' },
          ]}
        />
      )}
      {tab === 'records' ? <Records /> : <Structures />}
    </div>
  );
}
