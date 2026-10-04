import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../api/client.js';
import { useListQuery } from '../hooks/index.js';
import { getPath, idOf, setPath, toInputDate } from '../utils/format.js';
import DataTable, { RowAction } from './DataTable.jsx';
import DynamicForm, { clearOptionCache, useOptions } from './DynamicForm.jsx';
import { useConfirm } from './Confirm.jsx';
import { Button, Card, EmptyState, Modal, PageHeader, SearchInput } from './ui.jsx';

/** Convert a fetched row into form values (ids for refs, yyyy-mm-dd for dates). */
export function rowToForm(row, fields) {
  let out = {};
  for (const f of fields) {
    if (f.section) continue;
    let v = getPath(row, f.name);
    if (v === undefined || v === null) continue;
    if (f.type === 'date') v = toInputDate(v);
    else if (Array.isArray(v)) v = v.map(idOf);
    else if (typeof v === 'object') v = idOf(v);
    out = setPath(out, f.name, v);
  }
  return out;
}

/** Remove blanks; switch to FormData when a file is present. */
export function buildPayload(values, fields) {
  const clean = (o) => {
    if (Array.isArray(o)) return o;
    if (o && typeof o === 'object' && !(o instanceof File)) {
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        const c = clean(v);
        if (
          c === '' ||
          c === undefined ||
          c === null ||
          (c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof File) && !Object.keys(c).length)
        )
          continue;
        out[k] = c;
      }
      return out;
    }
    return o;
  };
  const payload = clean(values);
  if (fields.some((f) => f.type === 'file')) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
      else fd.append(k, v);
    }
    return fd;
  }
  return payload;
}

function FilterSelect({ filter, value, onChange }) {
  const { opts } = useOptions(filter);
  return (
    <select className="select" aria-label={filter.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{filter.label}: All</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Config-driven list + create/edit/delete page.
 * cfg: { title, subtitle, endpoint, entity, columns, fields, filters, searchPlaceholder, canCreate, canEdit(row), canDelete(row),
 *        toPayload(values, row), toForm(row), rowActions(row, reload), headerActions, defaultSort, createLabel, modalSize,
 *        emptyMessage, onSaved, deleteMessage(row), updateMethod, limit }
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
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const editable = fields.length > 0;

  const save = async (values) => {
    const isNew = editing === 'new';
    const body = cfg.toPayload ? cfg.toPayload(values, isNew ? null : editing) : values;
    const payload = buildPayload(body, fields);
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
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err, `Unable to delete this ${entity}.`));
    }
  };

  const showActions = editable || cfg.rowActions;
  const actions = showActions
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

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {cfg.headerActions}
            {editable && canCreate && (
              <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                {cfg.createLabel || `Add ${entity}`}
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
          empty={
            list.hasQuery ? (
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
                  editable && canCreate ? (
                    <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
                      {cfg.createLabel || `Add ${entity}`}
                    </Button>
                  ) : null
                }
              />
            )
          }
        />
      </Card>

      {editing && (
        <Modal
          title={editing === 'new' ? cfg.createLabel || `Add ${entity}` : `Edit ${entity}`}
          onClose={() => setEditing(null)}
          size={cfg.modalSize}
        >
          <DynamicForm
            fields={fields}
            initial={editing === 'new' ? cfg.defaults || {} : cfg.toForm ? cfg.toForm(editing) : rowToForm(editing, fields)}
            onSubmit={save}
            onCancel={() => setEditing(null)}
            submitLabel={editing === 'new' ? 'Create' : 'Save changes'}
          />
        </Modal>
      )}
    </div>
  );
}
