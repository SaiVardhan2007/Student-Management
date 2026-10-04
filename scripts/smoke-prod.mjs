// Production smoke test: boots the real entry point (server/src/server.js) in production mode against a throwaway
// in-memory MongoDB, checks health/readiness, the served SPA, security headers, and that SIGTERM shuts down cleanly.
//   npm run smoke      (requires `npm run build` first so client/dist exists)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5099;
const base = `http://127.0.0.1:${PORT}`;

if (!existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  console.error('client/dist is missing — run `npm run build` first.');
  process.exit(1);
}

const { MongoMemoryServer } = await import(
  pathToFileURL(path.join(root, 'server', 'node_modules', 'mongodb-memory-server', 'index.js')).href
);
const mongod = await MongoMemoryServer.create();

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: path.join(root, 'server'),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    SERVE_CLIENT: 'true',
    MONGODB_URI: mongod.getUri('sms_smoke'),
    CLIENT_URL: base,
    JWT_SECRET: 'smoke-access-secret-0123456789abcdef0123456789',
    JWT_REFRESH_SECRET: 'smoke-refresh-secret-0123456789abcdef012345',
    UPLOAD_DIR: path.join(os.tmpdir(), 'sms-smoke-uploads'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));
const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/ready`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

try {
  const up = await waitReady();
  check('server becomes ready', up, logs.slice(-500));
  if (up) {
    const health = await fetch(`${base}/api/health`);
    check('GET /api/health is 200', health.status === 200);
    check('responses carry X-Request-Id', !!health.headers.get('x-request-id'));
    check('X-Powered-By is hidden', !health.headers.get('x-powered-by'));
    check('CSP header is present', (health.headers.get('content-security-policy') || '').includes("default-src 'self'"));

    const index = await fetch(`${base}/`);
    const html = await index.text();
    check('SPA index is served', index.status === 200 && html.includes('<div id="root">'));
    check('index.html is revalidated', (index.headers.get('cache-control') || '').includes('no-cache'));

    const deep = await fetch(`${base}/students/123`);
    check('SPA fallback serves deep links', deep.status === 200 && (await deep.text()).includes('<div id="root">'));

    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    const assetRes = asset && (await fetch(`${base}${asset}`));
    check('hashed assets are immutable-cached', !!assetRes && (assetRes.headers.get('cache-control') || '').includes('immutable'));
    check('assets are gzip-compressed', !!assetRes && assetRes.headers.get('content-encoding') === 'gzip');

    const unknown = await fetch(`${base}/api/nope`);
    check('unknown API route is not served the SPA', unknown.status === 401 || unknown.status === 404);

    const bad = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":{"$ne":""},"password":"x"}',
    });
    check('NoSQL operator injection is rejected', bad.status === 400);

    if (process.platform === 'win32') {
      // Windows cannot deliver SIGTERM to a Node process as a catchable signal; Linux/Docker/CI verify this check.
      console.log('SKIP  graceful shutdown (not testable on Windows)');
    } else {
      child.kill('SIGTERM');
      const result = await Promise.race([exited, new Promise((r) => setTimeout(() => r({ code: 'timeout' }), 12000))]);
      check('graceful shutdown exits with code 0', result.code === 0, JSON.stringify(result));
    }
  }
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await mongod.stop().catch(() => {});
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.\n--- server log ---\n${logs}`);
  process.exit(1);
}
console.log('\nProduction smoke test passed.');
