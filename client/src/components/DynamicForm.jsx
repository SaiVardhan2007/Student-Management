import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../api/client.js';
import { Button, Field } from './ui.jsx';
import { getPath, setPath } from '../utils/format.js';

const optionCache = new Map();

/** Load <select> options from an API list endpoint (cached briefly). */
export function useOptions(field) {
  const [opts, setOpts] = useState(field.options || []);
  const [loading, setLoading] = useState(!!field.optionsUrl);
  useEffect(() => {
    if (!field.optionsUrl) { setOpts(field.options || []); return undefined; }
    let alive = true;
    const hit = optionCache.get(field.optionsUrl);
    const label = field.optionLabel || ((o) => o.name);
    const toOpts = (items) => items.map((o) => ({ value: o._id, label: label(o), raw: o }));
    if (hit && Date.now() - hit.at < 30000) { setOpts(toOpts(hit.items)); setLoading(false); return undefined; }
    api.get(field.optionsUrl, { params: { limit: 100, ...(field.optionsParams || {}) } })
      .then((r) => { optionCache.set(field.optionsUrl, { at: Date.now(), items: r.data.data }); if (alive) setOpts(toOpts(r.data.data)); })
      .catch(() => alive && setOpts([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.optionsUrl, JSON.stringify(field.optionsParams)]);
  return { opts, loading };
}
export const clearOptionCache = () => optionCache.clear();

function Control({ field, value, onChange, error, id, values }) {
  const { opts, loading } = useOptions(field);
  const common = { id, 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-err` : undefined, disabled: field.disabled };
  const options = field.filterOptions ? field.filterOptions(opts, values) : opts;

  switch (field.type) {
    case 'textarea':
      return <textarea className="textarea" rows={field.rows || 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={field.maxLength} {...common} />;
    case 'select':
      return (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common}>
          <option value="">{loading ? 'Loading…' : field.placeholder || 'Select…'}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'multiselect':
      return (
        <select className="select" multiple size={Math.min(6, Math.max(3, options.length))} style={{ height: 'auto' }} value={value || []} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))} {...common}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'checkbox':
      return (
        <label className="checkbox">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} {...common} /> {field.checkboxLabel || field.label}
        </label>
      );
    case 'file':
      return <input className="input" type="file" accept={field.accept} onChange={(e) => onChange(e.target.files?.[0] || null)} style={{ paddingTop: 5 }} {...common} />;
    default:
      return (
        <input className="input" type={field.type || 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder}
          min={field.min} max={field.max} step={field.step} maxLength={field.maxLength} autoComplete={field.autoComplete || 'off'} {...common} />
      );
  }
}

const PATTERNS = {
  email: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'],
  tel: [/^\+?[0-9][0-9\s-]{6,14}$/, 'Enter a valid phone number'],
};

export function validateField(field, value, values) {
  const empty = value === '' || value == null || (Array.isArray(value) && !value.length);
  if (field.required && empty) return `${field.label || 'This field'} is required`;
  if (empty) return null;
  const pat = field.pattern ? [field.pattern, field.patternMessage || 'Invalid format'] : PATTERNS[field.type];
  if (pat && typeof value === 'string' && !pat[0].test(value)) return pat[1];
  if (field.type === 'number') {
    const n = Number(value);
    if (Number.isNaN(n)) return 'Enter a number';
    if (field.min != null && n < Number(field.min)) return `Must be at least ${field.min}`;
    if (field.max != null && n > Number(field.max)) return `Must be at most ${field.max}`;
  }
  if (field.validate) return field.validate(value, values) || null;
  return null;
}

/**
 * fields: [{ name, label, type, required, options|optionsUrl, span2, section, hint, show(values), ... }]
 * onSubmit(values) must return a promise; API errors are mapped back onto the fields.
 */
export default function DynamicForm({ fields, initial = {}, onSubmit, onCancel, submitLabel = 'Save', busyLabel }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstErr = useRef(null);

  const set = (name, v) => {
    setValues((cur) => setPath(cur, name, v));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const visible = fields.filter((f) => !f.show || f.show(values));

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const found = {};
    for (const f of visible) {
      if (f.section) continue;
      const msg = validateField(f, getPath(values, f.name), values);
      if (msg) found[f.name] = msg;
    }
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError('Please fix the highlighted fields.');
      requestAnimationFrame(() => firstErr.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setFormError(errorMessage(err, 'Unable to save. Please check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate ref={firstErr}>
      {formError && <div className="form-error-summary" role="alert">{formError}</div>}
      <div className="form-grid">
        {visible.map((f, i) => {
          if (f.section) return <div key={`s${i}`} className="form-section">{f.section}</div>;
          const id = `f-${f.name.replace(/\./g, '-')}`;
          const isCheck = f.type === 'checkbox';
          return (
            <Field key={f.name} label={isCheck ? null : f.label} htmlFor={id} required={f.required} error={errors[f.name]} hint={f.hint} className={f.span2 || f.type === 'textarea' ? 'span-2' : ''}>
              <Control field={f} id={id} value={getPath(values, f.name)} onChange={(v) => set(f.name, v)} error={errors[f.name]} values={values} />
            </Field>
          );
        })}
      </div>
      <div className="form-actions">
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={busy}>{busy && busyLabel ? busyLabel : submitLabel}</Button>
      </div>
    </form>
  );
}
