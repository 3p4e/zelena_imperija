import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createMember, modelRef, newProject, providerId, startHarness, type Client, type Harness } from '../helpers/harness.js';

/** F. User A cannot read, modify or execute in user B's projects, keys, conversations or containers. */
describe('F. cross-user isolation through the API', () => {
  let h: Harness;
  let admin: Client;
  let alice: Client;
  let bob: Client;
  let bobId: string;
  let project: string;
  let conversation: string;
  let aliceKey: string;
  let executionId: string;

  beforeAll(async () => {
    h = await startHarness('wf_f');
    admin = await adminClient(h);
    alice = (await createMember(h, admin, 'alice@test.local')).client;
    const b = await createMember(h, admin, 'bob@test.local');
    bob = b.client;
    bobId = b.id;

    ({ projectId: project, conversationId: conversation } = await newProject(alice, 'Alice private'));
    const key = await alice.post<{ id: string }>('/api/keys', { providerId: await providerId(alice, 'openai'), apiKey: 'sk-alice-secret-9999' });
    aliceKey = key.body.id;
    await alice.put(`/api/projects/${project}/files/content`, { path: 'secret.txt', content: 'alice only' });
    await alice.sse(`/api/projects/${project}/exec`, { command: 'echo hi' });
    await alice.post(`/api/projects/${project}/preview-ports`, { port: 8000, label: 'web' });
    h.factory.script([{ kind: 'text', text: 'alice answer' }]);
    await alice.sse(`/api/conversations/${conversation}/messages`, { content: 'private question', modelId: await modelRef(admin, 'openai', 'gpt-5') });
    const execs = await alice.get<{ id: string }[]>(`/api/projects/${project}/executions`);
    executionId = execs.body[0]?.id ?? '';
    expect(executionId).not.toBe('');
  });
  afterAll(async () => h.close());

  it('hides the project from listings', async () => {
    const list = await bob.get<{ id: string }[]>('/api/projects');
    expect(list.body.map((p) => p.id)).not.toContain(project);
  });

  it('returns 404 for every project, conversation, sandbox and execution route', async () => {
    const attempts: [string, string, unknown?][] = [
      ['GET', `/api/projects/${project}`],
      ['PATCH', `/api/projects/${project}`, { name: 'pwned' }],
      ['DELETE', `/api/projects/${project}`],
      ['GET', `/api/projects/${project}/shares`],
      ['PUT', `/api/projects/${project}/shares`, { email: 'bob@test.local', permission: 'edit' }],
      ['GET', `/api/projects/${project}/conversations`],
      ['POST', `/api/projects/${project}/conversations`, {}],
      ['GET', `/api/conversations/${conversation}/messages`],
      ['PATCH', `/api/conversations/${conversation}`, { title: 'x' }],
      ['DELETE', `/api/conversations/${conversation}`],
      ['POST', `/api/conversations/${conversation}/messages`, { content: 'hi' }],
      ['POST', `/api/conversations/${conversation}/regenerate`, {}],
      ['POST', `/api/conversations/${conversation}/stop`, {}],
      ['GET', `/api/conversations/${conversation}/events`],
      ['GET', `/api/projects/${project}/sandbox`],
      ['POST', `/api/projects/${project}/sandbox/start`, {}],
      ['POST', `/api/projects/${project}/sandbox/stop`, {}],
      ['GET', `/api/projects/${project}/files`],
      ['GET', `/api/projects/${project}/files/content?path=secret.txt`],
      ['PUT', `/api/projects/${project}/files/content`, { path: 'secret.txt', content: 'overwritten' }],
      ['DELETE', `/api/projects/${project}/files/content?path=secret.txt`],
      ['POST', `/api/projects/${project}/exec`, { command: 'cat secret.txt' }],
      ['GET', `/api/projects/${project}/executions`],
      ['GET', `/api/executions/${executionId}/logs`],
      ['GET', `/api/projects/${project}/test-runs`],
      ['POST', `/api/projects/${project}/preview-ports`, { port: 9000 }],
      ['DELETE', `/api/projects/${project}/preview-ports/8000`],
      ['GET', `/api/projects/${project}/preview-url?port=8000`],
      ['GET', `/api/usage/summary?projectId=${project}`],
      ['GET', `/api/usage/records?projectId=${project}`],
    ];
    for (const [method, path, body] of attempts) {
      const r = await bob.request(method, path, body);
      expect(r.status, `${method} ${path} → ${JSON.stringify(r.body)}`).toBe(404);
    }
    // Nothing changed for Alice.
    const file = await alice.get<{ content: string }>(`/api/projects/${project}/files/content?path=secret.txt`);
    expect(file.body.content).toBe('alice only');
    const msgs = await alice.get<{ messages: unknown[] }>(`/api/conversations/${conversation}/messages`);
    expect(msgs.body.messages.length).toBe(2);
  });

  it('the admin does not see member project contents either', async () => {
    expect((await admin.get(`/api/projects/${project}`)).status).toBe(404);
    expect((await admin.get(`/api/conversations/${conversation}/messages`)).status).toBe(404);
    expect((await admin.get(`/api/projects/${project}/files`)).status).toBe(404);
  });

  it('cannot see, test or revoke another user’s keys', async () => {
    const keys = await bob.get<{ id: string }[]>('/api/keys');
    expect(keys.body.map((k) => k.id)).not.toContain(aliceKey);
    expect((await bob.post(`/api/keys/${aliceKey}/test`)).status).toBe(404);
    expect((await bob.del(`/api/keys/${aliceKey}`)).status).toBe(404);
    const aliceKeys = await alice.get<{ id: string; status: string }[]>('/api/keys');
    expect(aliceKeys.body.find((k) => k.id === aliceKey)?.status).toBe('active');
  });

  it('cannot open a terminal in another user’s container', async () => {
    const cookie = await bobCookie();
    const ws = new WebSocket(`${h.baseUrl.replace('http', 'ws')}/api/projects/${project}/terminal`, { headers: { cookie } });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('close', (code) => resolve(`close:${code}`));
      ws.on('unexpected-response', (_req, res) => resolve(`http:${res.statusCode ?? 0}`));
      ws.on('error', () => resolve('error'));
    });
    expect(['close:4403', 'http:404']).toContain(outcome);
  });

  it('cannot use a preview token forged for another project', async () => {
    const url = await alice.get<{ url: string }>(`/api/projects/${project}/preview-url?port=8000`);
    const forged = url.body.url.replace(/\.[0-9a-f-]{36}\./, `.${bobId}.`);
    expect((await fetch(`${h.baseUrl}${forged}`)).status).toBe(403);
  });

  it('sharing grants exactly the chosen permission and can be revoked', async () => {
    expect((await alice.put(`/api/projects/${project}/shares`, { email: 'bob@test.local', permission: 'read' })).status).toBe(200);
    expect((await bob.get(`/api/projects/${project}`)).status).toBe(200);
    expect((await bob.get(`/api/conversations/${conversation}/messages`)).status).toBe(200);
    expect((await bob.put(`/api/projects/${project}/files/content`, { path: 'secret.txt', content: 'x' })).status).toBe(403);
    expect((await bob.post(`/api/projects/${project}/exec`, { command: 'id' })).status).toBe(403);
    expect((await bob.del(`/api/projects/${project}`)).status).toBe(403);

    await alice.put(`/api/projects/${project}/shares`, { email: 'bob@test.local', permission: 'edit' });
    expect((await bob.put(`/api/projects/${project}/files/content`, { path: 'from-bob.txt', content: 'hello' })).status).toBe(200);
    expect((await bob.patch(`/api/projects/${project}`, { name: 'renamed' })).status).toBe(403);

    expect((await alice.del(`/api/projects/${project}/shares/${bobId}`)).status).toBe(200);
    expect((await bob.get(`/api/projects/${project}`)).status).toBe(404);
  });

  async function bobCookie(): Promise<string> {
    const res = await fetch(`${h.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bob@test.local', password: 'member-password-1' }),
    });
    return /agent_session=[^;]*/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
  }
});
