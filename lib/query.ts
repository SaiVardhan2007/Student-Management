import mongoose from 'mongoose';
import { AppError } from './errors';

export const isValidId = (id: unknown): id is string =>
  typeof id === 'string' && mongoose.isValidObjectId(id) && String(new mongoose.Types.ObjectId(id)) === id;

export const requireValidId = (id: unknown, label = 'id'): string => {
  if (!isValidId(id)) throw AppError.badRequest(`Invalid ${label}`);
  return id;
};

/** Escape user input before using inside a RegExp. */
export const escapeRegex = (s: unknown) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalise a date to 00:00:00 UTC of the given calendar day. */
export function toDay(input: any): Date {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest('Invalid date');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parsePagination(query: Record<string, any>, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

export const pageMeta = (page: number, limit: number, total: number) => ({ page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) });

/** Parse `?sort=field` / `?sort=-field` restricted to an allow list. */
export function parseSort(sort: unknown, allowed: string[], fallback: Record<string, any> = { createdAt: -1 }) {
  if (!sort || typeof sort !== 'string') return fallback;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? -1 : 1, _id: 1 };
}

export type PaginateOptions = {
  filter?: Record<string, any>;
  searchFields?: string[];
  allowedSort?: string[];
  defaultSort?: Record<string, any>;
  populate?: any;
  select?: string;
  defaultLimit?: number;
  maxLimit?: number;
};

/** Generic paginated find over `ctx.query` (page, limit, search, sort). */
export async function paginate(Model: mongoose.Model<any>, ctx: { query: Record<string, any> }, opts: PaginateOptions = {}) {
  const { page, limit, skip } = parsePagination(ctx.query, opts);
  const filter: Record<string, any> = { ...(opts.filter || {}) };
  const q = ctx.query.search;
  if (q && opts.searchFields?.length) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), 'i');
    filter.$and = [...(filter.$and || []), { $or: opts.searchFields.map((f) => ({ [f]: rx })) }];
  }
  const sort = parseSort(ctx.query.sort, opts.allowedSort || [], opts.defaultSort);
  let cursor: any = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (opts.populate) cursor = cursor.populate(opts.populate);
  if (opts.select) cursor = cursor.select(opts.select);
  const [items, total] = await Promise.all([cursor.lean(), Model.countDocuments(filter)]);
  return { items: items as any[], meta: pageMeta(page, limit, total) };
}

/** Pick only whitelisted keys from an object that exist. */
export const pick = (obj: Record<string, any>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/** Build a filter from allowed query keys, validating ObjectIds. */
export type FilterSpec = Record<string, 'id' | 'number' | 'bool' | 'string'>;

export function filtersFromQuery(query: Record<string, any>, spec: FilterSpec) {
  const filter: Record<string, any> = {};
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
