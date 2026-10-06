'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { titleCase } from '@/lib/format';

export function Button({ variant, size, icon, loading, children, className = '', type = 'button', ...rest }: any) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export const Spinner = ({ large }) => <span className={`spinner ${large ? 'spinner-lg' : ''}`} role="status" aria-label="Loading" />;

export function PageLoader({ label = 'Loading…' }: any) {
  return (
    <div className="state">
      <Spinner large />
      <p>{label}</p>
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, style }: any) {
  return <div className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: any) {
  return (
    <div role="status" aria-label="Loading data" style={{ padding: 16 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16, padding: '10px 0' }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} width={`${60 + ((r + c) % 4) * 10}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title = 'Nothing here yet', message, action }: any) {
  return (
    <div className="state">
      <Icon name={icon} size={36} />
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message = 'Unable to load data.', onRetry }: any) {
  return (
    <div className="state error" role="alert">
      <Icon name="alert" size={36} />
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <Button icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

const TONES = {
  success: [
    'active',
    'verified',
    'paid',
    'present',
    'approved',
    'resolved',
    'selected',
    'evaluated',
    'enrolled',
    'graduated',
    'published',
    'submitted',
  ],
  warning: [
    'pending',
    'partial',
    'late',
    'assigned',
    'in_progress',
    'shortlisted',
    'on_leave',
    'reupload_requested',
    'assessment',
    'interview',
    'medium',
    'high',
  ],
  danger: ['absent', 'rejected', 'overdue', 'suspended', 'dropped', 'urgent', 'inactive', 'failed'],
  info: ['excused', 'open', 'applied', 'closed', 'normal'],
};
export function Badge({ children, tone, value }: any) {
  const key = String(value ?? children).toLowerCase();
  const t = tone || Object.keys(TONES).find((k) => TONES[k].includes(key));
  return <span className={`badge ${t ? `badge-${t}` : ''}`}>{titleCase(children ?? value)}</span>;
}

export function Card({ title, actions, children, className = '', bodyClass = 'card-body', ...rest }: any) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {bodyClass ? <div className={bodyClass}>{children}</div> : children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: any) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, tone, loading }: any) {
  return (
    <div className={`card stat ${tone || ''}`}>
      <span className="stat-label">{label}</span>
      {loading ? <Skeleton width={70} height={28} /> : <span className="stat-value">{value ?? '—'}</span>}
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function ProgressBar({ value, threshold, label = 'Attendance' }: any) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const tone = threshold != null ? (v < threshold ? 'bad' : v < threshold + 10 ? 'warn' : 'good') : '';
  return (
    <div className={`progress ${tone}`} role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Alert({ tone = 'info', children, ...rest }: any) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'} {...rest}>
      {children}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: any) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size }: any) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button:not(.modal-close)');
    (first || ref.current)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [
          ...ref.current.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          ),
        ];
        if (!f.length) return;
        const a = f[0];
        const b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      (prev as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${size ? `modal-${size}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ghost btn-icon modal-close" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Promise-friendly confirm dialog: const ok = await confirm({ ... }) via useConfirm(). */
export function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, busy }: any) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: any) {
  return (
    <div className="search" style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-faint)' }}>
        <Icon name="search" size={16} />
      </span>
      <input
        className="input"
        style={{ paddingLeft: 32 }}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Avatar({ name, src, size }: any) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
  return <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`}>{src ? <img src={src} alt="" /> : initials}</span>;
}

/** Simple controlled field wrapper with label + error + hint. */
export function Field({ label, error, hint, required, children, htmlFor, className = '' }: any) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, show: () => setOpen(true), hide: () => setOpen(false), setOpen };
}
