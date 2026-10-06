import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, startHarness, Client, type Harness } from '../helpers/harness.js';

describe('J. admin-issued one-time password: username is the email, change forced at first login', () => {
  let h: Harness;
  let admin: Client;
  let userId = '';
  let temporaryPassword = '';

  beforeAll(async () => {
    h = await startHarness('wf_j');
    admin = await adminClient(h);
  });
  afterAll(async () => {
    await h.close();
  });

  it('creating a user returns a one-time password and the login URL, once', async () => {
    const res = await admin.post<{
      id: string;
      email: string;
      temporaryPassword: string;
      loginUrl: string;
    }>('/api/admin/users', { email: 'Sam@Test.Local', displayName: 'Sam', role: 'member' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('sam@test.local');
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(res.body.loginUrl).toMatch(/\/login$/);
    userId = res.body.id;
    temporaryPassword = res.body.temporaryPassword;
    const list = await admin.get<{ id: string; mustChangePassword: boolean }[]>('/api/admin/users');
    expect(JSON.stringify(list.body)).not.toContain(temporaryPassword);
    expect(list.body.find((u) => u.id === userId)?.mustChangePassword).toBe(true);
  });

  it('the user signs in with email + one-time password but can do nothing else until it is changed', async () => {
    const user = new Client(h.baseUrl);
    const login = await user.login('sam@test.local', temporaryPassword);
    expect(login.status).toBe(200);
    expect((login.body as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);
    expect((await user.get('/api/auth/me')).status).toBe(200);
    for (const p of ['/api/projects', '/api/keys', '/api/models', '/api/usage/records']) {
      expect((await user.get(p)).status, p).toBe(403);
    }
    expect((await user.post('/api/projects', { name: 'x' })).status).toBe(403);

    // The new password must differ and meet the length rule.
    expect(
      (await user.post('/api/auth/password', { currentPassword: temporaryPassword, newPassword: 'short' }))
        .status,
    ).toBe(400);
    expect(
      (
        await user.post('/api/auth/password', {
          currentPassword: temporaryPassword,
          newPassword: temporaryPassword,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await user.post('/api/auth/password', {
          currentPassword: temporaryPassword,
          newPassword: 'my-own-secret-pass',
        })
      ).status,
    ).toBe(200);
    expect((await user.get('/api/projects')).status).toBe(200);
    expect(
      ((await user.get('/api/auth/me')).body as { user: { mustChangePassword: boolean } }).user,
    ).toMatchObject({ mustChangePassword: false });

    // The one-time password is dead; the chosen one works.
    expect((await new Client(h.baseUrl).login('sam@test.local', temporaryPassword)).status).toBe(401);
    expect((await new Client(h.baseUrl).login('sam@test.local', 'my-own-secret-pass')).status).toBe(200);
  });

  it('admin can issue a fresh one-time password, which signs the user out and forces another change', async () => {
    const user = new Client(h.baseUrl);
    await user.login('sam@test.local', 'my-own-secret-pass');
    const res = await admin.post<{ temporaryPassword: string; email: string }>(
      `/api/admin/users/${userId}/reset-password`,
    );
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('sam@test.local');
    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(h.baseUrl).login('sam@test.local', 'my-own-secret-pass')).status).toBe(401);
    const again = new Client(h.baseUrl);
    expect((await again.login('sam@test.local', res.body.temporaryPassword)).status).toBe(200);
    expect((await again.get('/api/projects')).status).toBe(403);
  });

  it('an admin cannot reset their own password this way (it would lock them out)', async () => {
    const me = await admin.get<{ user: { id: string } }>('/api/auth/me');
    expect((await admin.post(`/api/admin/users/${me.body.user.id}/reset-password`)).status).toBe(400);
    expect((await admin.get('/api/admin/users')).status).toBe(200);
  });

  it('members cannot create users or issue one-time passwords', async () => {
    const mem = new Client(h.baseUrl);
    await mem.login(
      'sam@test.local',
      (await admin.post<{ temporaryPassword: string }>(`/api/admin/users/${userId}/reset-password`)).body
        .temporaryPassword,
    );
    expect((await mem.post('/api/admin/users', { email: 'x@test.local', displayName: 'x' })).status).toBe(
      403,
    );
  });
});
