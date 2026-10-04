import request from 'supertest';
import { setupDb, teardownDb, makeFixtures, auth, PASSWORD } from './helpers.js';
import { User } from '../src/models/index.js';
import { findUnsafeKey } from '../src/middleware/security.js';
import { readCookie } from '../src/utils/cookies.js';
import { createAdmin } from '../src/scripts/create-admin.js';

let app;
let fx;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

const cookieHeader = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('sms_refresh='));

describe('refresh-token cookie transport', () => {
  test('SPA clients get an httpOnly, strict, path-scoped cookie and no refresh token in the body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Token-Transport', 'cookie')
      .send({ email: 'stu1@t.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = cookieHeader(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  test('refresh works from the cookie alone, rotates it, and rejects reuse', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Token-Transport', 'cookie')
      .send({ email: 'stu2@t.local', password: PASSWORD });
    const first = cookieHeader(login).split(';')[0];

    const refreshed = await request(app).post('/api/auth/refresh').set('X-Token-Transport', 'cookie').set('Cookie', first).send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    expect(cookieHeader(refreshed).split(';')[0]).not.toBe(first);

    const reuse = await request(app).post('/api/auth/refresh').set('X-Token-Transport', 'cookie').set('Cookie', first).send({});
    expect(reuse.status).toBe(401);
  });

  test('refresh without any token is a 401, not a validation crash', async () => {
    expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(401);
  });

  test('logout clears the cookie and invalidates the refresh token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Token-Transport', 'cookie')
      .send({ email: 'fac1@t.local', password: PASSWORD });
    const cookie = cookieHeader(login).split(';')[0];
    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(cookieHeader(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({})).status).toBe(401);
  });

  test('readCookie tolerates malformed headers', () => {
    expect(readCookie({ headers: {} }, 'a')).toBeUndefined();
    expect(readCookie({ headers: { cookie: 'a=1; b=%E0%A4%A' } }, 'b')).toBeUndefined();
    expect(readCookie({ headers: { cookie: 'x=1; a=hello%20world' } }, 'a')).toBe('hello world');
  });
});

describe('account lockout', () => {
  test('locks after repeated failures, even for the correct password, and unlocks on expiry', async () => {
    const email = 'stu3@t.local';
    for (let i = 0; i < 5; i++) {
      const bad = await request(app).post('/api/auth/login').send({ email, password: 'Wrong@12345' });
      expect(bad.status).toBe(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/Too many failed attempts/);

    await User.updateOne({ email }, { lockUntil: new Date(Date.now() - 1000) });
    const ok = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(ok.status).toBe(200);
    const u = await User.findOne({ email }).select('+failedLogins +lockUntil');
    expect(u.failedLogins).toBe(0);
    expect(u.lockUntil).toBeUndefined();
  });

  test('lockout state is never serialised to clients', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'stu4@t.local', password: PASSWORD });
    expect(JSON.stringify(res.body)).not.toMatch(/failedLogins|lockUntil/);
  });
});

describe('input sanitising', () => {
  test('findUnsafeKey finds operator and dotted keys at any depth', () => {
    expect(findUnsafeKey({ a: { $gt: 1 } })).toBe('a.$gt');
    expect(findUnsafeKey({ list: [{ 'x.y': 1 }] })).toBe('list[0].x.y');
    expect(findUnsafeKey({ ok: { fine: [1, 2, { deep: true }] }, d: new Date() })).toBeNull();
    expect(findUnsafeKey(undefined)).toBeNull();
  });

  test('query operators are rejected loudly rather than silently dropped', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: '' }, password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid field name/);
    const q = await request(app).get('/api/health?filter[$where]=1');
    expect(q.status).toBe(400);
  });
});

describe('operations endpoints', () => {
  test('health and readiness respond, and every response carries a request id', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.headers['x-request-id']).toBeTruthy();
    const ready = await request(app).get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.success).toBe(true);
  });

  test('a client supplied request id is echoed back', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  test('security headers are set and the framework is not advertised', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  test('unknown API routes return a JSON 404 (and 401 when signed out)', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(401);
    const res = await request(app).get('/api/nope').set(auth(fx.tokens.admin));
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('malformed JSON returns 400 instead of 500', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
  });
});

describe('create-admin script', () => {
  const log = () => {};
  test('refuses weak passwords and missing input', async () => {
    await expect(createAdmin({ email: 'boss@t.local', password: 'weak', log })).rejects.toThrow(/too weak/);
    await expect(createAdmin({ email: '', password: '', log })).rejects.toThrow(/required/);
  });

  test('creates an admin once and is idempotent', async () => {
    const created = await createAdmin({ name: 'Boss', email: 'Boss@T.local', password: 'Str0ngPassw0rd', log });
    expect(created.role).toBe('admin');
    expect(created.email).toBe('boss@t.local');
    expect(await createAdmin({ email: 'boss@t.local', password: 'Str0ngPassw0rd', log })).toBeNull();
  });
});
