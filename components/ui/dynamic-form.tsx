'use client';

// Builds a form from a list of field descriptions (type, label, validation...).
// Used by ResourcePage and by dashboard pages with their own forms.

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, fieldErrors } from '@/lib/api-client';
import { Button, Field } from '@/components/ui';
import { getPath, setPath } from '@/lib/format';
import { useDebounce } from '@/hooks';

// Remembers option lists fetched from the API so many forms do not request the same list again.
// The key includes the url, the params and the search text, so different queries never share an entry.
const optionCache = new Map();
const OPTION_CACHE_MS = 30000;
const OPTION_PAGE = 100;

const freshHit = (key) => {
  const hit = optionCache.get(key);
  return hit && Date.now() - hit.at < OPTION_CACHE_MS ? hit : null;
};

/**
 * Gets the options for a select field: either fixed (field.options)
 * or loaded from the API (field.optionsUrl) and cached for 30 seconds.
 * Only the first 100 records are loaded; pass `search` to look further (the API search param).
 * Returns { opts, loading, total } where total is the number of matching records on the server.
 */
export function useOptions(field, search = '') {
  const url = field.optionsUrl;
  const params = url ? { limit: OPTION_PAGE, ...(field.optionsParams || {}), ...(search ? { search } : {}) } : null;
  const key = url ? JSON.stringify([url, params]) : '';
  const [remote, setRemote] = useState<any>({ key: '', items: [], total: 0 });
  useEffect(() => {
    if (!key || freshHit(key)) return undefined;
    // 'alive' stops us updating state after the component is gone or the field changed
    let alive = true;
    api
      .get(url, { params })
      .then((r) => {
        const entry = { at: Date.now(), items: r.data.data, total: r.data.meta?.total ?? r.data.data.length };
        optionCache.set(key, entry);
        if (alive) setRemote({ key, ...entry });
      })
      .catch(() => alive && setRemote({ key, items: [], total: 0 }));
    return () => {
      alive = false;
    };
    // `key` already contains the url and the params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!url) return { opts: field.options || [], loading: false, total: (field.options || []).length };
  const data = freshHit(key) || (remote.key === key ? remote : null);
  const label = field.optionLabel || ((o) => o.name);
  const opts = (data?.items || []).map((o) => ({ value: o._id, label: label(o), raw: o }));
  return { opts, loading: !data, total: data?.total ?? 0 };
}

/**
 * Select options plus a search box for long lists: options are searched on the server,
 * and values that are selected but not in the loaded page are still shown (looked up by id).
 */
export function useSearchableOptions(field, selected: string[] = []) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const { opts, loading, total } = useOptions(field, debounced);
  const [known, setKnown] = useState<Record<string, any>>({});
  const asked = useRef(new Set<string>());
  const label = field.optionLabel || ((o) => o.name);

  const loadedValues = new Set(opts.map((o) => o.value));
  const missing = selected.filter((id) => id && !loadedValues.has(id) && !known[id]);
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!field.optionsUrl) return;
    for (const id of missingKey ? missingKey.split(',') : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      api
        .get(`${field.optionsUrl}/${id}`)
        .then((r) => setKnown((k) => ({ ...k, [id]: { value: r.data.data._id, label: label(r.data.data), raw: r.data.data } })))
        .catch(() => {});
    }
    // label comes from the field config, which does not change between renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, field.optionsUrl]);

  const options = [...opts, ...selected.filter((id) => !loadedValues.has(id) && known[id]).map((id) => known[id])];
  /** Call from change handlers with the options just chosen, so they stay visible after the list is searched again. */
  const remember = (chosen: any[]) => setKnown((k) => ({ ...k, ...Object.fromEntries(chosen.map((o) => [o.value, o])) }));
  const searchable = !!field.optionsUrl && (total > OPTION_PAGE || !!query);
  return { options, opts, loading, total, query, setQuery, remember, searchable };
}

/** The small search box shown above a select whose list is longer than one page. */
export function OptionSearch({ query, onChange, total, shown, label }: any) {
  return (
    <div style={{ marginBottom: 6 }}>
      <input
        className="input"
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search ${label || 'options'}…`}
        aria-label={`Search ${label || 'options'}`}
      />
      {total > shown && (
        <div className="small faint">
          Showing first {shown} of {total} — type to search
        </div>
      )}
    </div>
  );
}

/** Call after creating/editing/deleting so dropdowns show fresh data. */
export function clearOptionCache() {
  optionCache.clear();
}

/** Renders the right input element for one field, depending on field.type. */
function Control({ field, value, onChange, error, id, values }: any) {
  const selectedIds: string[] = field.type === 'multiselect' ? value || [] : value ? [value] : [];
  const { options: loaded, opts, loading, total, query, setQuery, remember, searchable } = useSearchableOptions(field, selectedIds);
  const common = { id, 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-err` : undefined, disabled: field.disabled };
  const options = field.filterOptions ? field.filterOptions(loaded, values) : loaded;
  const search = searchable && <OptionSearch query={query} onChange={setQuery} total={total} shown={opts.length} label={field.label} />;

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          className="textarea"
          rows={field.rows || 3}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={field.maxLength}
          {...common}
        />
      );
    case 'select':
      return (
        <>
          {search}
          <select
            className="select"
            value={value ?? ''}
            onChange={(e) => {
              remember(options.filter((o) => o.value === e.target.value));
              onChange(e.target.value);
            }}
            {...common}
          >
            <option value="">{loading ? 'Loading…' : field.placeholder || 'Select…'}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      );
    case 'multiselect':
      return (
        <>
          {search}
          <select
            className="select"
            multiple
            size={Math.min(6, Math.max(3, options.length))}
            style={{ height: 'auto' }}
            value={value || []}
            onChange={(e) => {
              // options hidden by the search keep their selection: only the visible ones are changed by the user
              const visible = new Set(options.map((o) => o.value));
              const picked = [...e.target.selectedOptions].map((o) => o.value);
              remember(options.filter((o) => picked.includes(o.value)));
              onChange([...(value || []).filter((v) => !visible.has(v)), ...picked]);
            }}
            {...common}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      );
    case 'checkbox':
      return (
        <label className="checkbox">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} {...common} />{' '}
          {field.checkboxLabel || field.label}
        </label>
      );
    case 'file':
      return (
        <input
          className="input"
          type="file"
          accept={field.accept}
          onChange={(e) => onChange(e.target.files?.[0] || null)}
          style={{ paddingTop: 5 }}
          {...common}
        />
      );
    default:
      return (
        <input
          className="input"
          type={field.type || 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          maxLength={field.maxLength}
          autoComplete={field.autoComplete || 'off'}
          {...common}
        />
      );
  }
}

// Default format checks by field type: [regular expression, error message]
const PATTERNS = {
  email: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'],
  tel: [/^\+?[0-9][0-9\s-]{6,14}$/, 'Enter a valid phone number'],
};

/** Returns an error message for one field, or null when the value is valid. */
export function validateField(field, value, values) {
  const empty = value === '' || value == null || (Array.isArray(value) && !value.length);
  if (field.required && empty) return `${field.label || 'This field'} is required`;
  if (empty) return null;
  const pattern = field.pattern ? [field.pattern, field.patternMessage || 'Invalid format'] : PATTERNS[field.type];
  if (pattern && typeof value === 'string' && !pattern[0].test(value)) return pattern[1];
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
 *   name can be nested like 'address.city'; section: 'Title' adds a heading instead of an input;
 *   show(values) hides the field when it returns false; span2 makes it full width.
 * initial: starting values. onSubmit(values) must return a promise;
 * if it throws, API errors are shown on the matching fields.
 */
export default function DynamicForm({ fields, initial = {}, onSubmit, onCancel, submitLabel = 'Save', busyLabel }: any) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<any>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  const set = (name, v) => {
    setValues((cur) => setPath(cur, name, v));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  // Hidden fields are skipped in validation too
  const visible = fields.filter((f) => !f.show || f.show(values));

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const foundErrors: Record<string, any> = {};
    for (const field of visible) {
      if (field.section) continue;
      const message = validateField(field, getPath(values, field.name), values);
      if (message) foundErrors[field.name] = message;
    }
    setErrors(foundErrors);
    if (Object.keys(foundErrors).length > 0) {
      setFormError('Please fix the highlighted fields.');
      // Wait for the error styles to render, then focus the first invalid input
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err, 'Unable to save. Please check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate ref={formRef}>
      {formError && (
        <div className="form-error-summary" role="alert">
          {formError}
        </div>
      )}
      <div className="form-grid">
        {visible.map((f, i) => {
          if (f.section)
            return (
              <div key={`s${i}`} className="form-section">
                {f.section}
              </div>
            );
          const id = `f-${f.name.replace(/\./g, '-')}`;
          const isCheck = f.type === 'checkbox';
          return (
            <Field
              key={f.name}
              label={isCheck ? null : f.label}
              htmlFor={id}
              required={f.required}
              error={errors[f.name]}
              hint={f.hint}
              className={f.span2 || f.type === 'textarea' ? 'span-2' : ''}
            >
              <Control
                field={f}
                id={id}
                value={getPath(values, f.name)}
                onChange={(v) => set(f.name, v)}
                error={errors[f.name]}
                values={values}
              />
            </Field>
          );
        })}
      </div>
      <div className="form-actions">
        {onCancel && (
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          {busy && busyLabel ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
