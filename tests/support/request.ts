/**
 * A tiny supertest-compatible client that dispatches requests in-process to the real Next.js route handlers
 * (app/api/**\/route.ts), so the original API test-suite can run against the migrated application without a server.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { EventEmitter } from 'events';

const API_ROOT = path.join(process.cwd(), 'app', 'api');

type RouteEntry = { file: string; segments: string[]; score: number[] };

function scan(dir: string, segs: string[] = [], out: RouteEntry[] = []): RouteEntry[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) scan(path.join(dir, e.name), [...segs, e.name], out);
    else if (e.name === 'route.ts') out.push({ file: path.join(dir, e.name), segments: segs, score: segs.map((s) => (s.startsWith('[...') ? 0 : s.startsWith('[') ? 1 : 2)) });
  }
  return out;
}
const ROUTES = scan(API_ROOT);

function match(pathname: string) {
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  let best: { entry: RouteEntry; params: Record<string, string>; rank: number[] } | null = null;
  for (const entry of ROUTES) {
    const params: Record<string, string> = {};
    let ok = true;
    let i = 0;
    for (const seg of entry.segments) {
      if (seg.startsWith('[...')) {
        params[seg.slice(4, -1)] = parts.slice(i).join('/');
        i = parts.length;
        break;
      }
      if (i >= parts.length) {
        ok = false;
        break;
      }
      if (seg.startsWith('[')) params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) {
        ok = false;
        break;
      }
      i++;
    }
    if (!ok || i !== parts.length) continue;
    // prefer routes whose segments are more static (higher score from the left)
    if (!best || compare(entry.score, best.entry.score) > 0) best = { entry, params, rank: entry.score };
  }
  return best;
}
function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) - (b[i] ?? -1);
  }
  return 0;
}

export interface TestResponse {
  status: number;
  body: any;
  text: string;
  headers: Record<string, any>;
}

class Test implements PromiseLike<TestResponse> {
  private headers: Record<string, string> = {};
  private json: unknown;
  private form: FormData | null = null;
  private parser: ((res: any, cb: (err: any, body: any) => void) => void) | null = null;
  constructor(
    private method: string,
    private url: string
  ) {}

  set(a: string | Record<string, string>, b?: string) {
    if (typeof a === 'string') this.headers[a.toLowerCase()] = String(b);
    else for (const [k, v] of Object.entries(a)) this.headers[k.toLowerCase()] = String(v);
    return this;
  }
  send(body: unknown) {
    this.json = body;
    return this;
  }
  query(q: Record<string, any>) {
    const u = new URL(this.url, 'http://localhost');
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
    this.url = u.pathname + u.search;
    return this;
  }
  field(name: string, value: any) {
    this.form ||= new FormData();
    if (Array.isArray(value)) value.forEach((v) => this.form!.append(name, String(v)));
    else this.form.append(name, String(value));
    return this;
  }
  attach(name: string, data: Buffer | string, opts?: string | { filename?: string; contentType?: string }) {
    this.form ||= new FormData();
    const o = typeof opts === 'string' ? { filename: opts } : opts || {};
    const buf = typeof data === 'string' ? fs.readFileSync(data) : data;
    this.form.append(name, new Blob([new Uint8Array(buf)], { type: o.contentType || 'application/octet-stream' }), o.filename || 'file');
    return this;
  }
  buffer() {
    return this;
  }
  parse(fn: (res: any, cb: (err: any, body: any) => void) => void) {
    this.parser = fn;
    return this;
  }

  private async run(): Promise<TestResponse> {
    const url = new URL(this.url, 'http://localhost');
    const found = match(url.pathname);
    const headers = new Headers({ host: 'localhost', ...this.headers });
    let body: BodyInit | undefined;
    if (this.form) body = this.form;
    else if (this.json !== undefined) {
      body = JSON.stringify(this.json);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
    const request = new Request(url, { method: this.method, headers, body: this.method === 'GET' || this.method === 'HEAD' ? undefined : body });
    let response: Response;
    if (!found) {
      response = new Response(null, { status: 404 });
    } else {
      const mod = await import(/* @vite-ignore */ pathToFileURL(found.entry.file).href);
      const handler = mod[this.method];
      response = handler ? await handler(request, { params: Promise.resolve(found.params) }) : new Response(null, { status: 405 });
    }
    const hdrs: Record<string, any> = {};
    response.headers.forEach((v, k) => (hdrs[k] = v));
    const cookies = (response.headers as any).getSetCookie?.() as string[] | undefined;
    if (cookies?.length) hdrs['set-cookie'] = cookies;
    const raw = Buffer.from(await response.arrayBuffer());
    const type = String(hdrs['content-type'] || '');
    const text = raw.toString('utf8');
    let parsed: any = {};
    if (this.parser) {
      parsed = await new Promise((resolve, reject) => {
        const em = new EventEmitter();
        this.parser!(em, (err, b) => (err ? reject(err) : resolve(b)));
        em.emit('data', raw);
        em.emit('end');
      });
    } else if (type.includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
    }
    return { status: response.status, body: parsed, text, headers: hdrs };
  }

  then<R1 = TestResponse, R2 = never>(
    onfulfilled?: ((v: TestResponse) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((e: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/** `request(app)` — the `app` argument is ignored (kept for supertest compatibility). */
export default function request(_app?: unknown) {
  return {
    get: (u: string) => new Test('GET', u),
    post: (u: string) => new Test('POST', u),
    put: (u: string) => new Test('PUT', u),
    patch: (u: string) => new Test('PATCH', u),
    delete: (u: string) => new Test('DELETE', u),
  };
}
