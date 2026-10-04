import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, Client, adminClient, createMember, startHarness, type Harness } from '../helpers/harness.js';

const EXPECTED_PUBLIC = new Set([
  'POST /api/auth/login',
  'POST /api/auth/invites/accept',
  'POST /api/auth/password-reset/request',
  'POST /api/auth/password-reset/complete',
  'GET /healthz',
  'HEAD /healthz',
]);

function fillParams(url: string): string {
  return url
    .replace(':port', '8000')
    .replace(':kind', 'claude_code')
    .replace(':name', 'fs_read')
    .replace(/:[a-zA-Z]+/g, () => randomUUID())
    .replace('*', 'x');
}

describe('I. authentication', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('wf_i', { LOGIN_RATE_LIMIT_MAX: '5' });
  });
  afterAll(async () => h.close());

  it('denies unauthenticated requests on every non-public route', async () => {
    const routes = h.app.routeTable.filter((r) => !r.url.startsWith('/preview/'));
    expect(routes.length).toBeGreaterThan(60);
    const publicRoutes = routes.filter((r) => r.public).map((r) => `${r.method} ${r.url}`);
    expect(new Set(publicRoutes)).toEqual(EXPECTED_PUBLIC);

    const anon = new Client(h.baseUrl);
    for (const r of routes.filter((x) => !x.public)) {
      const path = fillParams(r.url);
      const res = await fetch(`${h.baseUrl}${path}`, {
        method: r.method,
        headers: r.method === 'GET' || r.method === 'HEAD' ? {} : { 'content-type': 'application/json' },
        ...(r.method === 'GET' || r.method === 'HEAD' ? {} : { body: '{}' }),
      });
      expect(res.status, `${r.method} ${r.url}`).toBe(401);
    }
    // A forged cookie is no better than none.
    const forged = await fetch(`${h.baseUrl}/api/projects`, {
      headers: { cookie: 'agent_session=forged-token-value' },
    });
    expect(forged.status).toBe(401);
    expect(anon.authenticated).toBe(false);
  });

  it('preview routes require a valid signed token instead of a session', async () => {
    for (const method of ['GET', 'POST']) {
      const r = await fetch(`${h.baseUrl}/preview/not-a-token/index.html`, { method });
      expect(r.status).toBe(403);
    }
  });

  it('rate-limits failed logins per email and IP', async () => {
    const admin = await adminClient(h);
    await createMember(h, admin, 'rl@test.local');
    const c = new Client(h.baseUrl);
    for (let i = 0; i < 5; i++) expect((await c.login('rl@test.local', 'wrong-password')).status).toBe(401);
    const blocked = await c.login('rl@test.local', 'member-password-1');
    expect(blocked.status).toBe(429);
  });

  it('invite links create accounts once; there is no open registration', async () => {
    const admin = await adminClient(h);
    const inv = await admin.post<{ acceptUrl: string; emailed: boolean }>('/api/admin/invites', {
      email: 'newbie@test.local',
      role: 'member',
    });
    expect(inv.status).toBe(201);
    expect(inv.body.emailed).toBe(true);
    expect(h.mail.at(-1)?.to).toBe('newbie@test.local');
    const token = new URL(inv.body.acceptUrl).searchParams.get('token') ?? '';

    const bad = new Client(h.baseUrl);
    expect(
      (
        await bad.post('/api/auth/invites/accept', {
          token: 'x'.repeat(40),
          displayName: 'n',
          password: 'long-password-1',
        })
      ).status,
    ).toBe(404);

    const c = new Client(h.baseUrl);
    const accepted = await c.post<{ user: { role: string } }>('/api/auth/invites/accept', {
      token,
      displayName: 'Newbie',
      password: 'newbie-password-1',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user.role).toBe('member');
    expect((await c.get('/api/projects')).status).toBe(200);
    expect(
      (
        await new Client(h.baseUrl).post('/api/auth/invites/accept', {
          token,
          displayName: 'Again',
          password: 'newbie-password-1',
        })
      ).status,
    ).toBe(404);

    // No route creates users without the admin.
    expect(h.app.routeTable.some((r) => /register|signup/i.test(r.url))).toBe(false);
  });

  it('password reset works by email and invalidates existing sessions', async () => {
    const admin = await adminClient(h);
    const { client: member } = await createMember(h, admin, 'reset@test.local');
    const anon = new Client(h.baseUrl);
    const req = await anon.post<{ ok: boolean }>('/api/auth/password-reset/request', {
      email: 'reset@test.local',
    });
    expect(req.body.ok).toBe(true);
    // Unknown emails get the same answer.
    expect((await anon.post('/api/auth/password-reset/request', { email: 'nobody@test.local' })).status).toBe(
      200,
    );
    const link = /https?:\/\/\S+/.exec(h.mail.at(-1)?.text ?? '')?.[0] ?? '';
    const token = new URL(link).searchParams.get('token') ?? '';
    expect(
      (await anon.post('/api/auth/password-reset/complete', { token, password: 'brand-new-password' }))
        .status,
    ).toBe(200);
    expect((await member.get('/api/projects')).status).toBe(401);
    expect((await new Client(h.baseUrl).login('reset@test.local', 'member-password-1')).status).toBe(401);
    expect((await new Client(h.baseUrl).login('reset@test.local', 'brand-new-password')).status).toBe(200);
    expect(
      (await anon.post('/api/auth/password-reset/complete', { token, password: 'another-password-1' }))
        .status,
    ).toBe(404);
  });

  it('suspending a user ends their sessions and blocks login', async () => {
    const admin = await adminClient(h);
    const { client, id } = await createMember(h, admin, 'sus@test.local');
    expect((await admin.patch(`/api/admin/users/${id}/status`, { status: 'suspended' })).status).toBe(200);
    expect((await client.get('/api/projects')).status).toBe(401);
    expect((await new Client(h.baseUrl).login('sus@test.local', 'member-password-1')).status).toBe(403);
    expect((await admin.patch(`/api/admin/users/${id}/status`, { status: 'active' })).status).toBe(200);
    expect((await new Client(h.baseUrl).login('sus@test.local', 'member-password-1')).status).toBe(200);
    // The admin cannot lock themselves out.
    const me = await admin.get<{ user: { id: string } }>('/api/auth/me');
    expect(
      (await admin.patch(`/api/admin/users/${me.body.user.id}/status`, { status: 'suspended' })).status,
    ).toBe(400);
  });

  it('logout ends the session', async () => {
    const c = new Client(h.baseUrl);
    await c.login(ADMIN.email, ADMIN.password);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('I. HTTPS enforcement outside localhost', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness('wf_i_https', { REQUIRE_HTTPS: 'true', TRUST_PROXY: 'true' });
  });
  afterAll(async () => h.close());

  it('redirects plain HTTP on a public hostname and accepts TLS terminated at the proxy', async () => {
    // fetch() cannot override Host, so use node:http directly.
    const plain = await rawGet(h.baseUrl, '/api/projects', { host: 'agent.example.com' });
    expect(plain.status).toBe(308);
    expect(plain.location).toBe('https://agent.example.com/api/projects');
    const viaProxy = await rawGet(h.baseUrl, '/api/projects', {
      host: 'agent.example.com',
      'x-forwarded-proto': 'https',
    });
    expect(viaProxy.status).toBe(401);
    const local = await fetch(`${h.baseUrl}/api/projects`);
    expect(local.status).toBe(401);
  });
});

function rawGet(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; location: string | undefined }> {
  const u = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location });
    });
    req.on('error', reject);
    req.end();
  });
}
