import mongoose from 'mongoose';
import { AppError } from './AppError.js';

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data, message = 'OK', status = 200, meta) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};
export const created = (res, data, message = 'Created') => ok(res, data, message, 201);

export const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id) && String(new mongoose.Types.ObjectId(id)) === id;

export const requireValidId = (id, label = 'id') => {
  if (!isValidId(id)) throw AppError.badRequest(`Invalid ${label}`);
  return id;
};

/** Escape user input before using inside a RegExp. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalise a date to 00:00:00 UTC of the given calendar day. */
export function toDay(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest('Invalid date');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

export const pageMeta = (page, limit, total) => ({ page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) });

/** Parse `?sort=field` / `?sort=-field` restricted to an allow list. */
export function parseSort(sort, allowed, fallback = { createdAt: -1 }) {
  if (!sort || typeof sort !== 'string') return fallback;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? -1 : 1, _id: 1 };
}

/**
 * Generic paginated find.
 * opts: { filter, search, searchFields, sort, allowedSort, populate, select, query }
 */
export async function paginate(Model, req, opts = {}) {
  const { page, limit, skip } = parsePagination(req.query, opts);
  const filter = { ...(opts.filter || {}) };
  const q = req.query.search;
  if (q && opts.searchFields?.length) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), 'i');
    filter.$and = [...(filter.$and || []), { $or: opts.searchFields.map((f) => ({ [f]: rx })) }];
  }
  const sort = parseSort(req.query.sort, opts.allowedSort || [], opts.defaultSort);
  let cursor = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (opts.populate) cursor = cursor.populate(opts.populate);
  if (opts.select) cursor = cursor.select(opts.select);
  const [items, total] = await Promise.all([cursor.lean(), Model.countDocuments(filter)]);
  return { items, meta: pageMeta(page, limit, total) };
}

/** Pick only whitelisted keys from an object that exist. */
export const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/** Build a filter from allowed query keys, validating ObjectIds. */
export function filtersFromQuery(query, spec) {
  const filter = {};
  for (const [key, type] of Object.entries(spec)) {
    const v = query[key];
    if (v === undefined || v === '' || Array.isArray(v) || typeof v === 'object') continue;
    if (type === 'id') {
      if (!isValidId(v)) throw AppError.badRequest(`Invalid ${key}`);
      filter[key] = v;
    } else if (type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) throw AppError.badRequest(`Invalid ${key}`);
      filter[key] = n;
    } else if (type === 'bool') {
      filter[key] = v === 'true';
    } else {
      filter[key] = String(v);
    }
  }
  return filter;
}
