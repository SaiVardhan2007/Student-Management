import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok, created, paginate, filtersFromQuery, requireValidId } from '../utils/http.js';
import { audit } from '../services/audit.js';

/**
 * Generic CRUD controller factory used by simple, configuration-style resources.
 *
 * opts:
 *  Model, entity            – Mongoose model + label used in audit/messages
 *  searchFields, filterSpec – for list (?search=..., ?field=value)
 *  allowedSort, defaultSort
 *  populate, select
 *  scope(req)               – async fn returning an extra filter (authorization scoping)
 *  dependents               – [{ Model, field, label }] blocks delete when referenced
 *  beforeCreate/afterCreate/beforeUpdate/afterUpdate(req, doc?) hooks
 */
export function crud(opts) {
  const { Model, entity, searchFields = [], filterSpec = {}, allowedSort = [], defaultSort, populate, select } = opts;

  const list = asyncHandler(async (req, res) => {
    const scoped = opts.scope ? await opts.scope(req) : {};
    const filter = { ...filtersFromQuery(req.query, filterSpec), ...scoped };
    const { items, meta } = await paginate(Model, req, {
      filter,
      searchFields,
      allowedSort: ['createdAt', ...allowedSort],
      defaultSort,
      populate,
      select,
    });
    ok(res, items, 'OK', 200, meta);
  });

  const findScoped = async (req) => {
    requireValidId(req.params.id);
    const scoped = opts.scope ? await opts.scope(req) : {};
    return { _id: req.params.id, ...scoped };
  };

  const get = asyncHandler(async (req, res) => {
    let q = Model.findOne(await findScoped(req));
    if (populate) q = q.populate(populate);
    const doc = await q;
    if (!doc) throw AppError.notFound(`${entity} not found`);
    ok(res, doc);
  });

  const create = asyncHandler(async (req, res) => {
    if (opts.beforeCreate) await opts.beforeCreate(req);
    const doc = await Model.create(opts.withCreator ? { ...req.body, [opts.withCreator]: req.user._id } : req.body);
    if (opts.afterCreate) await opts.afterCreate(req, doc);
    await audit(req, `${entity.toUpperCase()}_CREATED`, entity, doc._id);
    created(res, doc, `${entity} created`);
  });

  const update = asyncHandler(async (req, res) => {
    const doc = await Model.findOne(await findScoped(req));
    if (!doc) throw AppError.notFound(`${entity} not found`);
    if (opts.beforeUpdate) await opts.beforeUpdate(req, doc);
    doc.set(req.body);
    await doc.save();
    if (opts.afterUpdate) await opts.afterUpdate(req, doc);
    await audit(req, `${entity.toUpperCase()}_UPDATED`, entity, doc._id, { fields: Object.keys(req.body) });
    ok(res, doc, `${entity} updated`);
  });

  const remove = asyncHandler(async (req, res) => {
    const doc = await Model.findOne(await findScoped(req));
    if (!doc) throw AppError.notFound(`${entity} not found`);
    for (const d of opts.dependents || []) {
      const n = await d.Model.countDocuments({ [d.field]: doc._id });
      if (n) throw AppError.conflict(`Cannot delete ${entity.toLowerCase()}: it is used by ${n} ${d.label}. Remove or reassign them first.`);
    }
    if (opts.beforeDelete) await opts.beforeDelete(req, doc);
    await doc.deleteOne();
    await audit(req, `${entity.toUpperCase()}_DELETED`, entity, doc._id);
    ok(res, null, `${entity} deleted`);
  });

  return { list, get, create, update, remove };
}
