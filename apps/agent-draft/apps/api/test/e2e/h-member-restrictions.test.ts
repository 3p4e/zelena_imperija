import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  createMember,
  modelRef,
  newProject,
  providerId,
  startHarness,
  type Client,
  type Harness,
} from '../helpers/harness.js';

const ADMIN_SECRET = 'sk-admin-secret-XYZ123-never-leak';

describe('H. members cannot reach subscription CLI mode, restricted tools or shared key values', () => {
  let h: Harness;
  let admin: Client;
  let member: Client;
  let memberId: string;
  let projectId: string;
  let conversationId: string;
  let gpt5: string;

  beforeAll(async () => {
    // CLI mode enabled on the server so the checks are about roles, not configuration.
    h = await startHarness('wf_h', { CLI_RUNNER_ENABLED: 'true' });
    admin = await adminClient(h);
    ({ client: member, id: memberId } = await createMember(h, admin, 'max@test.local'));
    const key = await admin.post<{ id: string }>('/api/keys', {
      providerId: await providerId(admin, 'openai'),
      apiKey: ADMIN_SECRET,
    });
    gpt5 = await modelRef(admin, 'openai', 'gpt-5');
    await admin.post('/api/admin/shared-grants', {
      userKeyId: key.body.id,
      memberUserId: memberId,
      dailyLimitUsd: 100,
      monthlyLimitUsd: 100,
    });
    await admin.patch('/api/admin/cli/claude_code', { enabled: true });
    ({ projectId, conversationId } = await newProject(member, 'Member project'));
  });
  afterAll(async () => h.close());

  it('rejects subscription CLI mode on every endpoint that accepts a selection', async () => {
    const cli = { credentialMode: 'subscription_cli', cliKind: 'claude_code' };
    const attempts: [string, string, unknown][] = [
      ['POST', `/api/conversations/${conversationId}/messages`, { content: 'hi', ...cli }],
      ['POST', `/api/conversations/${conversationId}/regenerate`, cli],
      ['PATCH', `/api/conversations/${conversationId}`, cli],
      ['POST', `/api/projects/${projectId}/conversations`, cli],
      [
        'POST',
        '/api/projects',
        { name: 'x', defaultCredentialMode: 'subscription_cli', defaultCliKind: 'claude_code' },
      ],
      ['PATCH', `/api/projects/${projectId}`, { defaultCredentialMode: 'subscription_cli' }],
      ['PUT', '/api/me/defaults', { defaultModelId: null, defaultCredentialMode: 'subscription_cli' }],
    ];
    for (const [method, path, body] of attempts) {
      const r = await member.request(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    expect((await member.get('/api/cli/options')).body).toEqual([]);
    const me = await member.get<{ capabilities: { subscriptionCli: boolean } }>('/api/auth/me');
    expect(me.body.capabilities.subscriptionCli).toBe(false);
    for (const [method, path] of [
      ['GET', '/api/admin/cli'],
      ['PATCH', '/api/admin/cli/claude_code'],
      ['POST', '/api/admin/cli/claude_code/check'],
    ] as const) {
      expect(
        (await member.request(method, path, method === 'GET' ? undefined : { enabled: true })).status,
      ).toBe(403);
    }
    // Nothing was stored: the conversation still has no CLI selection.
    const msgs = await member.get<{
      conversation: { credentialMode: string | null; cliKind: string | null };
    }>(`/api/conversations/${conversationId}/messages`);
    expect(msgs.body.conversation).toMatchObject({ credentialMode: null, cliKind: null });

    // Control: the admin can select it.
    const own = await newProject(admin, 'Admin CLI');
    expect((await admin.patch(`/api/conversations/${own.conversationId}`, cli)).status).toBe(200);
  });

  it('enforces per-member tool restrictions server-side', async () => {
    const set = await admin.put(`/api/admin/users/${memberId}/tool-restrictions`, {
      restrictions: [{ toolName: 'shell_exec', allowed: false }],
    });
    expect(set.status).toBe(200);
    const tools = await member.get<{ name: string }[]>('/api/tools');
    expect(tools.body.map((t) => t.name)).not.toContain('shell_exec');
    expect(tools.body.map((t) => t.name)).toContain('fs_write');

    h.factory.script([
      { kind: 'tool_call', name: 'shell_exec', arguments: { command: 'id' } },
      { kind: 'text', text: 'done' },
    ]);
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'run id',
      modelId: gpt5,
    });
    const offered = h.factory.requests.at(-2)?.tools ?? [];
    expect(offered).not.toContain('shell_exec');
    expect(offered).toContain('fs_read');
    const result = run.events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ toolName: 'shell_exec', isError: true });
    expect(JSON.stringify(result)).toContain('not available');

    // The admin is never restricted.
    const adminTools = await admin.get<{ name: string }[]>('/api/tools');
    expect(adminTools.body.map((t) => t.name)).toContain('shell_exec');
  });

  it('never returns shared key values through any member-reachable endpoint', async () => {
    const paths = [
      '/api/keys',
      '/api/models',
      '/api/providers',
      '/api/tools',
      '/api/auth/me',
      '/api/usage/summary',
      '/api/usage/records',
      '/api/me/defaults',
      '/api/projects',
    ];
    for (const p of paths) {
      const r = await member.get(p);
      expect(r.status, p).toBe(200);
      expect(JSON.stringify(r.body), p).not.toContain('sk-admin-secret');
    }
    for (const p of [
      '/api/admin/shared-grants',
      '/api/admin/users',
      '/api/admin/providers',
      '/api/admin/settings',
      '/api/admin/models',
      '/api/admin/mcp-servers',
    ]) {
      expect((await member.get(p)).status, p).toBe(403);
    }
    // Members cannot test, revoke or re-share the admin's key.
    const adminKeys = await admin.get<{ id: string }[]>('/api/keys');
    const id = adminKeys.body[0]?.id ?? '';
    expect((await member.post(`/api/keys/${id}/test`)).status).toBe(404);
    expect((await member.del(`/api/keys/${id}`)).status).toBe(404);
    expect(
      (
        await member.post('/api/admin/shared-grants', {
          userKeyId: id,
          memberUserId: memberId,
          dailyLimitUsd: 1,
          monthlyLimitUsd: 1,
        })
      ).status,
    ).toBe(403);
    // Even the admin's own listing never contains the plaintext.
    expect(JSON.stringify((await admin.get('/api/keys')).body)).not.toContain(ADMIN_SECRET);
  });
});
