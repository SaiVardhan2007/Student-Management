'use client';

// Fees. Students/parents see what they owe, what they paid (each payment is an installment with a receipt)
// and what is pending; students pay online through Razorpay Checkout. Admin sets what each student owes,
// records offline payments and, in a second tab, manages fee structures and assigns them to students.
// APIs: /fees, /fees/:id, /fees/:id/pay, /fees/:id/razorpay/{order,verify}, /fees/:id/receipt/:no, /fees/structures

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { useFetch, useListQuery } from '@/hooks';
import { api, errorMessage } from '@/lib/api-client';
import DataTable, { RowAction } from '@/components/ui/data-table';
import DynamicForm from '@/components/ui/dynamic-form';
import ResourcePage from '@/components/ui/resource-page';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, StatCard, Tabs } from '@/components/ui';
import { useConfirm } from '@/components/providers/confirm-provider';
import { fmtDate, fmtMoney, fullName, titleCase } from '@/lib/format';
import { SEMESTERS } from '@/lib/constants';

const STATUSES = ['pending', 'partial', 'paid', 'overdue'].map((s) => ({ value: s, label: titleCase(s) }));

/** Printable receipt for one payment. */
function Receipt({ fee, receiptNo, onClose }: any) {
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

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Load Razorpay's Checkout script once. */
function loadCheckout(): Promise<any> {
  const w = window as any;
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = CHECKOUT_SRC;
    el.onload = () => resolve(w.Razorpay);
    el.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.body.appendChild(el);
  });
}

/** Student: pay any amount up to the pending balance through Razorpay Checkout. */
function OnlinePayModal({ fee, user, onClose, onPaid }: any) {
  const pay = async (v) => {
    const amount = Number(v.amount);
    const [Razorpay, order] = await Promise.all([
      loadCheckout(),
      api.post(`/fees/${fee._id}/razorpay/order`, { amount }).then((r) => r.data.data),
    ]);
    await new Promise<void>((resolve) => {
      const rzp = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: process.env.NEXT_PUBLIC_APP_NAME || 'Fee payment',
        description: order.title,
        prefill: { name: user.name, email: user.email },
        handler: async (resp) => {
          try {
            const r = await api.post(`/fees/${fee._id}/razorpay/verify`, resp);
            toast.success(`Payment successful — receipt ${r.data.data.receiptNo}`);
            onPaid();
          } catch (e) {
            // money may have moved; the webhook (if set up) will still record it
            toast.error(`${errorMessage(e)}. If money was deducted it will show up shortly.`);
          }
          resolve();
        },
        modal: { ondismiss: () => resolve() },
      });
      rzp.on('payment.failed', (r) => toast.error(r.error?.description || 'Payment failed'));
      rzp.open();
    });
  };

  return (
    <Modal title="Pay fee" onClose={onClose} size="sm">
      <p className="small muted">
        {fee.title} · pending {fmtMoney(fee.amountPending)}
      </p>
      <p className="small muted">You can pay the full balance or a part of it as an installment.</p>
      <DynamicForm
        initial={{ amount: String(fee.amountPending) }}
        submitLabel="Pay with Razorpay"
        busyLabel="Opening payment…"
        onCancel={onClose}
        onSubmit={pay}
        fields={[{ name: 'amount', label: 'Amount (INR)', type: 'number', min: 1, max: fee.amountPending, step: 0.01, required: true, span2: true }]}
      />
    </Modal>
  );
}

/** Admin: record a payment received outside the portal (cash, card machine, bank transfer). */
function RecordPaymentModal({ fee, onClose, onPaid }: any) {
  const pay = async (v) => {
    const r = await api.post(`/fees/${fee._id}/pay`, { amount: Number(v.amount), method: v.method });
    toast.success(`Payment recorded — receipt ${r.data.data.receiptNo}`);
    onPaid();
  };
  return (
    <Modal title="Record payment" onClose={onClose} size="sm">
      <p className="small muted">
        {fee.title} · pending {fmtMoney(fee.amountPending)}
      </p>
      <DynamicForm
        initial={{ amount: String(fee.amountPending), method: 'cash' }}
        submitLabel="Record"
        busyLabel="Saving…"
        onCancel={onClose}
        onSubmit={pay}
        fields={[
          { name: 'amount', label: 'Amount', type: 'number', min: 0.01, max: fee.amountPending, step: 0.01, required: true, span2: true },
          {
            name: 'method',
            label: 'Method',
            type: 'select',
            required: true,
            span2: true,
            options: ['cash', 'card', 'upi', 'netbanking'].map((m) => ({ value: m, label: titleCase(m) })),
          },
        ]}
      />
    </Modal>
  );
}

/** Admin: set what a student owes (new fee) or change the total / due date of an existing one. */
function FeeFormModal({ fee, onClose, onSaved }: any) {
  const editing = !!fee;
  const save = async (v) => {
    const body = { title: v.title, amountDue: Number(v.amountDue), dueDate: v.dueDate };
    if (editing) await api.patch(`/fees/${fee._id}`, body);
    else await api.post('/fees', { ...body, student: v.student });
    toast.success(editing ? 'Fee updated' : 'Fee created');
    onSaved();
  };
  return (
    <Modal title={editing ? 'Edit fee' : 'Set fee for a student'} onClose={onClose} size="sm">
      {editing && (
        <p className="small muted">
          {fee.student?.studentId} · {fullName(fee.student)} · already paid {fmtMoney(fee.amountPaid)}
        </p>
      )}
      <DynamicForm
        initial={
          editing
            ? { title: fee.title, amountDue: String(fee.amountDue), dueDate: String(fee.dueDate).slice(0, 10) }
            : { title: '', amountDue: '', dueDate: '', student: '' }
        }
        submitLabel="Save"
        onCancel={onClose}
        onSubmit={save}
        fields={[
          ...(editing
            ? []
            : [
                {
                  name: 'student',
                  label: 'Student',
                  type: 'select',
                  optionsUrl: '/students',
                  optionLabel: (s) => `${s.studentId} — ${fullName(s)}`,
                  required: true,
                  span2: true,
                },
              ]),
          { name: 'title', label: 'Fee name', required: true, span2: true },
          { name: 'amountDue', label: 'Total amount to pay', type: 'number', min: editing ? fee.amountPaid || 1 : 1, step: 0.01, required: true },
          { name: 'dueDate', label: 'Due date', type: 'date', required: true },
        ]}
      />
    </Modal>
  );
}

/** Fee records tab. Parents can only view; students and admin can pay what is pending. */
function Records() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const list = useListQuery('/fees', { limit: 15 });
  const confirm = useConfirm();
  const [pay, setPay] = useState(null);
  const [receipt, setReceipt] = useState(null);
  // null = closed, 'new' = set a fee for a student, or the fee being edited
  const [editing, setEditing] = useState<any>(null);
  // Totals for the cards shown to students/parents (only the current page of fees).
  const pending = list.items.reduce((sum, f) => sum + f.amountPending, 0);
  const paid = list.items.reduce((sum, f) => sum + f.amountPaid, 0);
  const total = list.items.reduce((sum, f) => sum + f.amountDue, 0);

  const remove = async (f) => {
    const ok = await confirm({ title: 'Delete this fee?', message: `${f.title} for ${fullName(f.student)} will be removed.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/fees/${f._id}`);
      toast.success('Fee deleted');
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="stack">
      {!isAdmin && (
        <div className="grid grid-stats">
          <StatCard label="Total fee" value={fmtMoney(total)} />
          <StatCard label="Total paid" value={fmtMoney(paid)} />
          <StatCard label="Outstanding" value={fmtMoney(pending)} tone={pending ? 'warn' : ''} />
        </div>
      )}
      <Card bodyClass={null}>
        <div className="table-toolbar">
          {isAdmin && (
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Set fee for a student
            </Button>
          )}
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
              label: 'Payments (installments)',
              render: (f) =>
                f.payments?.length
                  ? f.payments.map((p) => (
                      <Button key={p.receiptNo} size="sm" variant="ghost" onClick={() => setReceipt({ fee: f, no: p.receiptNo })}>
                        {fmtMoney(p.amount)} · {fmtDate(p.paidAt)}
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
              ? (f) => (
                  <>
                    {f.amountPending > 0 && (
                      <Button size="sm" variant="primary" onClick={() => setPay(f)}>
                        {isAdmin ? 'Record payment' : 'Pay now'}
                      </Button>
                    )}
                    {isAdmin && (
                      <>
                        <Button size="sm" onClick={() => setEditing(f)}>
                          Edit
                        </Button>
                        {!f.amountPaid && (
                          <Button size="sm" variant="ghost" onClick={() => remove(f)}>
                            Delete
                          </Button>
                        )}
                      </>
                    )}
                  </>
                )
              : undefined
          }
        />
      </Card>
      {pay && isAdmin && (
        <RecordPaymentModal
          fee={pay}
          onClose={() => setPay(null)}
          onPaid={() => {
            setPay(null);
            list.reload();
          }}
        />
      )}
      {pay && !isAdmin && (
        <OnlinePayModal
          fee={pay}
          user={user}
          onClose={() => setPay(null)}
          onPaid={() => {
            setPay(null);
            list.reload();
          }}
        />
      )}
      {editing && (
        <FeeFormModal
          fee={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
      {receipt && <Receipt fee={receipt.fee} receiptNo={receipt.no} onClose={() => setReceipt(null)} />}
    </div>
  );
}

/** Admin tab: fee templates per program and semester, which can be assigned to all students. */
function Structures() {
  const confirm = useConfirm();
  const assign = async (s) => {
    const ok = await confirm({
      title: 'Assign fee to students?',
      message: `Create a fee record of ${fmtMoney(s.amount)} for every active student in ${s.program?.code} semester ${s.semester}. Existing records are left untouched.`,
      confirmLabel: 'Assign',
    });
    if (!ok) return;
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
      // Structures cannot be edited after creation (delete and create again instead).
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
      <PageHeader title="Fees" subtitle="Fee dues, payments and receipts" />
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
      {/* Only admin sees the tabs, so everyone else always gets the records view. */}
      {tab === 'records' ? <Records /> : <Structures />}
    </div>
  );
}
