'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '@/lib/api-client';
import { useListQuery } from '@/hooks';
import { getPath, idOf, setPath, toInputDate } from '@/lib/format';
import DataTable, { RowAction } from '@/components/ui/data-table';
import DynamicForm, { OptionSearch, clearOptionCache, useSearchableOptions } from '@/components/ui/dynamic-form';
import { useConfirm } from '@/components/providers/confirm-provider';
import { Button, Card, EmptyState, Modal, PageHeader, SearchInput } from '@/components/ui';

/**
 * Turns a row from the API into the values the edit form needs:
 * dates become yyyy-mm-dd, and populated references become plain ids.
 */
export function rowToForm(row, fields) {
  let formValues: Record<string, any> = {};
  for (const field of fields) {
    if (field.section) continue; // section headings have no value
    let value = getPath(row, field.name);
    if (value === undefined || value === null) continue;

    if (field.type === 'date') {
      value = toInputDate(value);
    } else if (Array.isArray(value)) {
      value = value.map(idOf);
    } else if (typeof value === 'object') {
      value = idOf(value);
    }
    formValues = setPath(formValues, field.name, value);
  }
  return formValues;
}

/** True for values that should not be sent to the API: '', null, undefined or an empty object. */
function isBlank(value) {
  if (value === '' || value === undefined || value === null) return true;
  const isPlainObject = typeof value === 'object' && !Array.isArray(value) && !(value instanceof File);
  return isPlainObject && Object.keys(value).length === 0;
}

/** Returns a copy of the data with all blank values removed (also inside nested objects). */
function removeBlanks(data) {
  const isPlainObject = data && typeof data === 'object' && !Array.isArray(data) && !(data instanceof File);
  if (!isPlainObject) return data;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const cleaned = removeBlanks(value);
    if (!isBlank(cleaned)) result[key] = cleaned;
  }
  return result;
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof File) && !(v instanceof Date);

/**
 * Puts null into the payload for every field that had a value in `initial` but is blank now,
 * so the API clears it (a blank value that is simply left out would keep the old value).
 */
function markCleared(payload, initial, values) {
  for (const [key, before] of Object.entries(initial || {})) {
    if (!values || !(key in values)) continue; // not part of what the form submits (e.g. dropped by toPayload)
    const now = values[key];
    if (isPlain(before)) {
      const nested = isPlain(payload[key]) ? payload[key] : {};
      markCleared(nested, before, isPlain(now) ? now : {});
      if (Object.keys(nested).length) payload[key] = nested;
    } else if (!isBlank(before) && isBlank(now)) {
      payload[key] = null;
    }
  }
  return payload;
}

/**
 * Prepares form values to send to the API: blank values are removed.
 * When editing, pass the values the form started with: fields the user blanked are sent as null (meaning "clear").
 * If the form has a file field, the data is returned as FormData (needed for uploads).
 */
export function buildPayload(values, fields, initial?) {
  const payload = removeBlanks(values);
  if (initial && isPlain(payload)) markCleared(payload, initial, values);
  const hasFileField = fields.some((field) => field.type === 'file');
  if (!hasFileField) return payload;

  const formData = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value === null) continue; // FormData cannot carry null
    if (Array.isArray(value)) {
      value.forEach((item) => formData.append(key, item));
    } else {
      formData.append(key, value as string | Blob);
    }
  }
  return formData;
}

/** A dropdown filter shown above the table. */
function FilterSelect({ filter, value, onChange }: any) {
  const { options, opts, total, query, setQuery, searchable } = useSearchableOptions(filter, value ? [value] : []);
  return (
    <>
      {searchable && <OptionSearch query={query} onChange={setQuery} total={total} shown={opts.length} label={filter.label} />}
      <select className="select" aria-label={filter.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{filter.label}: All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * A complete list page with search, filters, table, pagination and create/edit/delete,
 * all driven by one config object (the props). Used by most pages in app/(dashboard).
 *
 * Config fields:
 *   title, subtitle      page heading
 *   endpoint             API path, e.g. '/students'
 *   entity               singular name used in messages, e.g. 'student'
 *   columns              table columns (see DataTable)
 *   fields               form fields (see DynamicForm); no fields means the page is read-only
 *   filters              dropdown filters shown above the table
 *   searchPlaceholder    placeholder text for the search box
 *   limit                rows per page (default 15)
 *   defaultSort          initial sort, e.g. '-createdAt'
 *   initialFilters       initial filter values
 *   canCreate            show the "Add" button (default true)
 *   canEdit(row)         whether a row can be edited (default always)
 *   canDelete(row)       whether a row can be deleted (default always)
 *   deletable            set to false to hide the delete button
 *   createLabel          text of the "Add" button and create modal title
 *   modalSize            size of the create/edit modal
 *   emptyMessage         text shown when the table has no rows
 *   deleteMessage(row)   custom text for the delete confirmation
 *   defaults             starting form values when creating
 *   toForm(row)          custom conversion of a row into form values (default: rowToForm)
 *   toPayload(values, row) change the form values before sending them to the API
 *   updateMethod         HTTP method for updates (default 'patch')
 *   rowActions(row, reload) extra buttons in each row
 *   headerActions        extra buttons in the page header (or a function (list) => buttons; list.queryParams has the current search/filters)
 *   onSaved(data)        called after a successful save
 */
export default function ResourcePage(cfg) {
  const {
    title,
    subtitle,
    endpoint,
    entity = 'record',
    columns,
    fields = [],
    filters = [],
    canCreate = true,
    canEdit = () => true,
    canDelete = () => true,
  } = cfg;
  const list = useListQuery(endpoint, { limit: cfg.limit || 15, initialSort: cfg.defaultSort, initialFilters: cfg.initialFilters });
  const confirm = useConfirm();
  // What the modal is doing: null (closed), 'new' (creating) or the row being edited
  const [editing, setEditing] = useState(null);
  const editable = fields.length > 0;

  // Called by the form. If it throws, DynamicForm shows the API errors on the fields.
  const save = async (values) => {
    const isNew = editing === 'new';
    const body = cfg.toPayload ? cfg.toPayload(values, isNew ? null : editing) : values;
    const payload = buildPayload(body, fields, isNew ? undefined : formInitialValues);
    const res = isNew ? await api.post(endpoint, payload) : await api[cfg.updateMethod || 'patch'](`${endpoint}/${editing._id}`, payload);
    toast.success(res.data.message || `${entity} saved`);
    clearOptionCache();
    setEditing(null);
    list.reload();
    cfg.onSaved?.(res.data.data);
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: `Delete ${entity}?`,
      message: cfg.deleteMessage ? cfg.deleteMessage(row) : `This will permanently delete this ${entity}. This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`${endpoint}/${row._id}`);
      toast.success(`${entity} deleted`);
      clearOptionCache();
      // deleting the only row of the last page: step back so we do not land on an empty page
      if (list.items.length === 1 && list.page > 1) list.setPage(list.page - 1);
      else list.reload();
    } catch (err) {
      toast.error(errorMessage(err, `Unable to delete this ${entity}.`));
    }
  };

  const showActionsColumn = editable || cfg.rowActions;
  const actions = showActionsColumn
    ? (row) => (
        <>
          {cfg.rowActions?.(row, list.reload)}
          {editable && canEdit(row) && <RowAction icon="edit" label={`Edit ${entity}`} onClick={() => setEditing(row)} />}
          {cfg.deletable !== false && canDelete(row) && (
            <RowAction icon="trash" label={`Delete ${entity}`} danger onClick={() => remove(row)} />
          )}
        </>
      )
    : undefined;

  const createButtonLabel = cfg.createLabel || `Add ${entity}`;
  const showCreateButton = editable && canCreate;

  let formInitialValues;
  if (editing === 'new') {
    formInitialValues = cfg.defaults || {};
  } else if (editing && cfg.toForm) {
    formInitialValues = cfg.toForm(editing);
  } else if (editing) {
    formInitialValues = rowToForm(editing, fields);
  }

  // Shown when the table has no rows: either nothing matches the search, or the list is truly empty
  const emptyState = list.hasQuery ? (
    <EmptyState
      title="No matching results"
      message="Try a different search or clear the filters."
      action={<Button onClick={list.resetFilters}>Clear filters</Button>}
    />
  ) : (
    <EmptyState
      title={`No ${entity}s yet`}
      message={cfg.emptyMessage || `Add your first ${entity} to get started.`}
      action={
        showCreateButton ? (
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            {createButtonLabel}
          </Button>
        ) : null
      }
    />
  );

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {typeof cfg.headerActions === 'function' ? cfg.headerActions(list) : cfg.headerActions}
            {showCreateButton && (
              <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                {createButtonLabel}
              </Button>
            )}
          </>
        }
      />
      <Card bodyClass={null}>
        <div className="table-toolbar">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder={cfg.searchPlaceholder || 'Search…'} />
          {filters.map((f) => (
            <FilterSelect key={f.name} filter={f} value={list.filters[f.name]} onChange={(v) => list.setFilter(f.name, v)} />
          ))}
          {list.hasQuery && (
            <Button size="sm" variant="ghost" onClick={list.resetFilters}>
              Clear
            </Button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={list.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          meta={list.meta}
          page={list.page}
          onPage={list.setPage}
          sort={list.sort}
          onSort={list.setSort}
          actions={actions}
          empty={emptyState}
        />
      </Card>

      {editing && (
        <Modal
          title={editing === 'new' ? createButtonLabel : `Edit ${entity}`}
          onClose={() => setEditing(null)}
          size={cfg.modalSize}
        >
          <DynamicForm
            fields={fields}
            initial={formInitialValues}
            onSubmit={save}
            onCancel={() => setEditing(null)}
            submitLabel={editing === 'new' ? 'Create' : 'Save changes'}
          />
        </Modal>
      )}
    </div>
  );
}
