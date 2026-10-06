import type { Model } from 'mongoose';
import { AppError } from '@/lib/errors';
import { ok, created } from '@/lib/response';
import { paginate, filtersFromQuery, requireValidId } from '@/lib/query';
import type { Ctx } from '@/lib/context';
import { audit } from '@/services/audit';

export interface CrudOptions {
  Model: Model<any>;
  /** label used in audit entries and messages */
  entity: string;
  searchFields?: string[];
  filterSpec?: Record<string, 'id' | 'number' | 'bool' | 'string'>;
  allowedSort?: string[];
  defaultSort?: Record<string, any>;
  populate?: any;
  select?: string;
  /** extra filter used for authorisation scoping (applied to list, get, update and delete) */
  scope?: (ctx: Ctx) => Promise<Record<string, any>> | Record<string, any>;
  /** records referencing the document block its deletion */
  dependents?: { Model: Model<any>; field: string; label: string }[];
  /** store the creating user's id under this field */
  withCreator?: string;
  beforeCreate?: (ctx: Ctx) => Promise<unknown> | unknown;
  afterCreate?: (ctx: Ctx, doc: any) => Promise<unknown> | unknown;
  beforeUpdate?: (ctx: Ctx, doc: any) => Promise<unknown> | unknown;
  afterUpdate?: (ctx: Ctx, doc: any) => Promise<unknown> | unknown;
  beforeDelete?: (ctx: Ctx, doc: any) => Promise<unknown> | unknown;
}

/**
 * Generic CRUD service factory used by simple, configuration-style resources (departments, programs, exams…).
 * Returns plain service functions `(ctx) => ApiResult`; route files decide who may call them.
 */
export function crud(opts: CrudOptions) {
  const { Model, entity, searchFields = [], filterSpec = {}, allowedSort = [], defaultSort, populate, select } = opts;

  async function list(ctx: Ctx) {
    const scoped = opts.scope ? await opts.scope(ctx) : {};
    const filter = { ...filtersFromQuery(ctx.query, filterSpec), ...scoped };
    const { items, meta } = await paginate(Model, ctx, {
      filter,
      searchFields,
      allowedSort: ['createdAt', ...allowedSort],
      defaultSort,
      populate,
      select,
    });
    return ok(items, 'OK', 200, meta);
  }

  const findScoped = async (ctx: Ctx) => {
    requireValidId(ctx.params.id);
    const scoped = opts.scope ? await opts.scope(ctx) : {};
    return { _id: ctx.params.id, ...scoped };
  };

  async function get(ctx: Ctx) {
    let q: any = Model.findOne(await findScoped(ctx));
    if (populate) q = q.populate(populate);
    const doc = await q;
    if (!doc) throw AppError.notFound(`${entity} not found`);
    return ok(doc);
  }

  async function create(ctx: Ctx) {
    if (opts.beforeCreate) await opts.beforeCreate(ctx);
    const doc = await Model.create(opts.withCreator ? { ...ctx.body, [opts.withCreator]: ctx.user._id } : ctx.body);
    if (opts.afterCreate) await opts.afterCreate(ctx, doc);
    await audit(ctx, `${entity.toUpperCase()}_CREATED`, entity, doc._id);
    return created(doc, `${entity} created`);
  }

  async function update(ctx: Ctx) {
    const doc = await Model.findOne(await findScoped(ctx));
    if (!doc) throw AppError.notFound(`${entity} not found`);
    if (opts.beforeUpdate) await opts.beforeUpdate(ctx, doc);
    doc.set(ctx.body);
    await doc.save();
    if (opts.afterUpdate) await opts.afterUpdate(ctx, doc);
    await audit(ctx, `${entity.toUpperCase()}_UPDATED`, entity, doc._id, { fields: Object.keys(ctx.body) });
    return ok(doc, `${entity} updated`);
  }

  async function remove(ctx: Ctx) {
    const doc = await Model.findOne(await findScoped(ctx));
    if (!doc) throw AppError.notFound(`${entity} not found`);
    for (const d of opts.dependents || []) {
      const n = await d.Model.countDocuments({ [d.field]: doc._id });
      if (n)
        throw AppError.conflict(`Cannot delete ${entity.toLowerCase()}: it is used by ${n} ${d.label}. Remove or reassign them first.`);
    }
    if (opts.beforeDelete) await opts.beforeDelete(ctx, doc);
    await doc.deleteOne();
    await audit(ctx, `${entity.toUpperCase()}_DELETED`, entity, doc._id);
    return ok(null, `${entity} deleted`);
  }

  return { list, get, create, update, remove };
}

export type CrudService = ReturnType<typeof crud>;
