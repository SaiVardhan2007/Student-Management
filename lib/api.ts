import { NextResponse } from 'next/server';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ZodError, type ZodTypeAny } from 'zod';
import { env } from './env';
import { AppError } from './errors';
import { logger } from './logger';
import { connectDB } from './mongodb';
import { authenticate } from './auth';
import { rateLimit } from './rate-limit';
import { findUnsafeKey } from './security';
import { parseMultipart, removeUploadedFiles, type UploadSpec } from './upload';
import { formatZodError } from '@/validators/common';
import { ApiResult } from './response';
import type { Ctx, Role } from './context';

export { ok, created, ApiResult } from './response';
export type { Ctx, Role } from './context';

export interface RouteOptions {
  /** roles allowed to call the route; omit for "any signed-in user" */
  roles?: Role[];
  /** no authentication (login, register, public branding…) */
  public?: boolean;
  /** apply the stricter authentication rate limit */
  authLimiter?: boolean;
  /** zod schema for the JSON / form body */
  body?: ZodTypeAny;
  /** zod schema for the query string */
  query?: ZodTypeAny;
  /** accept multipart uploads */
  upload?: UploadSpec;
}

type Handler = (ctx: Ctx) => Promise<ApiResult | Response> | ApiResult | Response;

const MAX_JSON_BYTES = 1024 * 1024;

export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim());
    const hops = env.trustProxy;
    return (hops > 0 ? parts[Math.max(parts.length - hops, 0)] : parts[0]) || 'unknown';
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

async function readBody(request: Request, upload?: UploadSpec) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return { fields: {}, files: [] as any[] };
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.includes('multipart/form-data')) {
    if (!upload) return { fields: {}, files: [] };
    return parseMultipart(request, upload);
  }
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new AppError('Request body too large', 413);
  if (!text.trim()) return { fields: {}, files: [] };
  if (type.includes('application/x-www-form-urlencoded')) {
    const out: Record<string, any> = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = k in out ? [].concat(out[k], v as any) : v;
    return { fields: out, files: [] };
  }
  try {
    const parsed = JSON.parse(text);
    return { fields: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}, files: [] };
  } catch {
    throw AppError.badRequest('Malformed JSON in request body');
  }
}

function queryObject(request: Request) {
  const out: Record<string, any> = {};
  for (const [k, v] of new URL(request.url).searchParams) out[k] = k in out ? [].concat(out[k], v as any) : v;
  return out;
}

function validateWith(schema: ZodTypeAny, data: unknown) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const errors = formatZodError(result.error);
    throw AppError.badRequest(`Validation failed: ${errors[0].field} — ${errors[0].message}`, errors);
  }
  return result.data;
}

/** Map any thrown value to the standard error envelope. */
export function errorResponse(err: any, requestId: string, label = ''): NextResponse {
  let status = err?.statusCode || 500;
  let message = err?.message || 'Internal server error';
  let errors = err?.errors;

  if (err instanceof ZodError) {
    status = 400;
    errors = formatZodError(err);
    message = 'Validation failed';
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    errors = Object.values(err.errors).map((e: any) => ({ field: e.path, message: e.message }));
    message = 'Validation failed';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err?.code === 11000) {
    status = 409;
    const fields = Object.keys(err.keyPattern || {});
    message = `Duplicate value: ${fields.join(', ') || 'a unique field'} already exists`;
    errors = fields.map((f) => ({ field: f, message: 'Already exists' }));
  }

  if (status >= 500) {
    logger.error(`${label} -> ${status}: ${err?.message}`, err);
    if (env.isProd) message = 'Internal server error. Please try again later.';
  }
  const body: Record<string, unknown> = { success: false, message };
  if (errors) body.errors = errors;
  if (!env.isProd && status >= 500) body.stack = err?.stack;
  const res = NextResponse.json(body, { status });
  res.headers.set('X-Request-Id', requestId);
  return res;
}

/**
 * Wrap a service function as a Next.js route handler:
 *   rate limit → DB → authenticate → authorise → parse body/query → sanitise → validate → service → envelope.
 * Errors thrown anywhere (AppError, Zod, Mongoose…) become consistent JSON error responses.
 */
export function route(opts: RouteOptions, handler: Handler) {
  return async function routeHandler(request: Request, rc?: { params?: Promise<any> }): Promise<Response> {
    const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
    const label = `${request.method} ${new URL(request.url).pathname}`;
    let uploaded: any[] = [];
    try {
      const ip = clientIp(request);
      if (!env.isTest) {
        const general = rateLimit(`api:${ip}`, env.apiRateLimit);
        if (general.limited) throw new AppError('Too many requests. Please slow down and try again shortly.', 429);
        if (opts.authLimiter && rateLimit(`auth:${ip}`, env.authRateLimit).limited)
          throw new AppError('Too many attempts. Please try again in 15 minutes.', 429);
      }
      await connectDB();

      const params = (rc?.params ? await rc.params : {}) as Record<string, string>;
      const ctx: Ctx = { request, user: undefined, params, query: queryObject(request), body: {}, files: [], ip, requestId };

      if (!opts.public) {
        // cookie sessions are same-site only: refuse cross-origin state-changing requests outright
        const origin = request.headers.get('origin');
        const host = request.headers.get('host');
        if (origin && host && request.method !== 'GET' && !request.headers.get('authorization')) {
          if (new URL(origin).host !== host) throw AppError.forbidden('Cross-site request blocked');
        }
        ctx.user = await authenticate(request);
        if (opts.roles && !opts.roles.includes(ctx.user.role)) throw AppError.forbidden();
      }

      const { fields, files } = await readBody(request, opts.upload);
      uploaded = files;
      ctx.files = files;
      ctx.file = files[0];
      ctx.body = fields;

      for (const [part, value] of [
        ['body', ctx.body],
        ['query', ctx.query],
        ['params', ctx.params],
      ] as const) {
        const bad = findUnsafeKey(value);
        if (bad) throw AppError.badRequest(`Invalid field name in request ${part}: "${bad}"`);
      }
      if (opts.body) ctx.body = validateWith(opts.body, ctx.body);
      if (opts.query) ctx.query = validateWith(opts.query, ctx.query);

      const result = await handler(ctx);
      if (result instanceof Response) {
        result.headers.set('X-Request-Id', requestId);
        return result;
      }
      const res = NextResponse.json(result.body, { status: result.status });
      for (const c of result.cookies) res.cookies.set(c.name, c.value, c.opts);
      res.headers.set('X-Request-Id', requestId);
      return res;
    } catch (err) {
      if (uploaded.length) await removeUploadedFiles(uploaded);
      return errorResponse(err, requestId, label);
    }
  };
}

/** Routes the framework cannot match get the standard 404 envelope. */
export const apiNotFound = route({}, async (ctx) => {
  throw AppError.notFound(`Route not found: ${ctx.request.method} ${new URL(ctx.request.url).pathname}`);
});
