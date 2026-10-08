'use client';

// Small shared UI building blocks (button, card, modal, badge, field...) used across the whole app.

import { useEffect, useId, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { titleCase } from '@/lib/format';

/** Button with optional variant/size/icon. Shows a spinner and is disabled while loading. */
export function Button({ variant, size, icon, loading, children, className = '', type = 'button', ...rest }: any) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ large }: any) {
  return <span className={`spinner ${large ? 'spinner-lg' : ''}`} role="status" aria-label="Loading" />;
}

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

/** Grey placeholder rows shown while a table loads. */
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

// Which badge colour to use for each status word
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
/** Coloured pill for a status. The colour is picked from the value unless `tone` is given. */
export function Badge({ children, tone, value }: any) {
  const key = String(value ?? children).toLowerCase();
  const badgeTone = tone || Object.keys(TONES).find((name) => TONES[name].includes(key));
  return <span className={`badge ${badgeTone ? `badge-${badgeTone}` : ''}`}>{titleCase(children ?? value)}</span>;
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

/** Progress bar from 0 to 100. With `threshold`, it turns red below it and yellow just above it. */
export function ProgressBar({ value, threshold, label = 'Attendance' }: any) {
  const percent = Math.max(0, Math.min(100, value ?? 0));
  let tone = '';
  if (threshold != null) {
    if (percent < threshold) tone = 'bad';
    else if (percent < threshold + 10) tone = 'warn';
    else tone = 'good';
  }
  return (
    <div
      className={`progress ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${percent}%` }} />
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

/**
 * Dialog window. Closes on Escape or a click on the dark backdrop.
 * Keeps keyboard focus inside while open and gives it back to the previous element on close.
 */
export function Modal({ title, onClose, children, footer, size }: any) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const firstInput = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button:not(.modal-close)');
    (firstInput || ref.current)?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();

      // Focus trap: Tab on the last element goes to the first (and Shift+Tab the other way)
      if (e.key === 'Tab' && ref.current) {
        const focusable = [
          ...ref.current.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          ),
        ];
        if (focusable.length === 0) return;
        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind the dialog from scrolling
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      (previouslyFocused as HTMLElement | null)?.focus?.();
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

/** Yes/No dialog. Normally opened through useConfirm() (see confirm-provider). */
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

/** Round avatar: shows the image if given, otherwise the first letters of the name. */
export function Avatar({ name, src, size }: any) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`}>
      {/* src is a short-lived blob: URL of a protected file; next/image cannot optimise those */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

/** Wraps an input with its label, required star, hint and error message. */
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

/** Open/closed state for things like modals: const { open, show, hide } = useDisclosure(). */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, show: () => setOpen(true), hide: () => setOpen(false), setOpen };
}
