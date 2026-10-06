import request from './support/request';
import { setupDb, teardownDb, makeFixtures, login, auth, PASSWORD } from './helpers';
import { User } from '@/models';

let app: any;
let fx: any;
beforeAll(async () => {
  app = await setupDb();
  fx = await makeFixtures(app);
}, 120000);
afterAll(teardownDb);

describe('authentication', () => {
  test('logs in with valid credentials and never returns the password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@t.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.email).toBe('admin@t.local');
    expect(JSON.stringify(res.body)).not.toMatch(/"password"|\$2[aby]\$/i);
  });

  test('stores only a bcrypt hash', async () => {
    const u = await User.findOne({ email: 'admin@t.local' }).select('+password');
    expect(u.password).not.toBe(PASSWORD);
    expect(u.password).toMatch(/^\$2[aby]\$/);
  });

  test('rejects wrong password and unknown email with the same message', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'admin@t.local', password: 'Wrong@12345' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@t.local', password: 'Wrong@12345' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  test('validates login payload', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test('blocks NoSQL operator injection in login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: '' }, password: { $ne: '' } });
    expect(res.status).toBe(400);
  });

  test('protected routes require a token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  test('/me returns the current user', async () => {
    const res = await request(app).get('/api/auth/me').set(auth(fx.tokens.stu1));
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('student');
    expect(res.body.data.profile.studentId).toBe('S1');
  });

  test('refresh rotates tokens and logout revokes them', async () => {
    const { refreshToken, accessToken } = await login(app, 'stu2@t.local');
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(r1.status).toBe(200);
    // old refresh token is single use
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);
    const out = await request(app).post('/api/auth/logout').set(auth(accessToken)).send({ refreshToken: r1.body.data.refreshToken });
    expect(out.status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: r1.body.data.refreshToken })).status).toBe(401);
  });

  test('change password enforces policy and current password', async () => {
    const { accessToken } = await login(app, 'fac2@t.local');
    const bad = await request(app)
      .post('/api/auth/change-password')
      .set(auth(accessToken))
      .send({ currentPassword: 'nope', newPassword: 'NewPass@123' });
    expect(bad.status).toBe(400);
    const weak = await request(app)
      .post('/api/auth/change-password')
      .set(auth(accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'weak' });
    expect(weak.status).toBe(400);
    const good = await request(app)
      .post('/api/auth/change-password')
      .set(auth(accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'NewPass@123' });
    expect(good.status).toBe(200);
    expect(await login(app, 'fac2@t.local', 'NewPass@123')).toBeTruthy();
    // the old access token is invalidated by the password change
    expect((await request(app).get('/api/auth/me').set(auth(accessToken))).status).toBe(401);
  });

  test('deactivated accounts cannot log in or use an existing token', async () => {
    const { accessToken } = await login(app, 'stu2@t.local');
    await User.updateOne({ email: 'stu2@t.local' }, { isActive: false });
    expect((await request(app).post('/api/auth/login').send({ email: 'stu2@t.local', password: PASSWORD })).status).toBe(403);
    expect((await request(app).get('/api/auth/me').set(auth(accessToken))).status).toBe(403);
    await User.updateOne({ email: 'stu2@t.local' }, { isActive: true });
  });

  test('forgot/reset password flow', async () => {
    // in test env the link is not returned, so read the token hash path by issuing directly
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'stu1@t.local' });
    expect(res.status).toBe(200);
    // unknown emails get the same generic response (no account enumeration)
    const res2 = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@t.local' });
    expect(res2.body.message).toBe(res.body.message);
    const bad = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'x'.repeat(64), newPassword: 'Another@123' });
    expect(bad.status).toBe(400);
  });
});
