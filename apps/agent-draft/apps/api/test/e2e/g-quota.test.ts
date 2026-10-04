import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createMember, modelRef, newProject, providerId, startHarness, type Client, type Harness } from '../helpers/harness.js';

// gpt-5 is seeded at $1.25 / Mtok input: one million input tokens ≈ $1.25.
const EXPENSIVE = { inputTokens: 1_000_000, outputTokens: 10 };
const ADMIN_KEY = 'sk-admin-openai-shared-0001';
const MEMBER_KEY = 'sk-member-openai-own-0002';

describe('G. member quotas on admin-shared keys', () => {
  let h: Harness;
  let admin: Client;
  let member: Client;
  let memberId: string;
  let gpt5: string;
  let gpt41: string;
  let grantId: string;
  let conversationId: string;

  beforeAll(async () => {
    h = await startHarness('wf_g');
    admin = await adminClient(h);
    ({ client: member, id: memberId } = await createMember(h, admin, 'mia@test.local'));
    const key = await admin.post<{ id: string }>('/api/keys', { providerId: await providerId(admin, 'openai'), apiKey: ADMIN_KEY });
    gpt5 = await modelRef(admin, 'openai', 'gpt-5');
    gpt41 = await modelRef(admin, 'openai', 'gpt-4.1');
    const grant = await admin.post<{ id: string }>('/api/admin/shared-grants', {
      userKeyId: key.body.id,
      memberUserId: memberId,
      dailyLimitUsd: 1,
      monthlyLimitUsd: 100,
      allowedModelIds: [gpt5],
    });
    expect(grant.status).toBe(201);
    grantId = grant.body.id;
    ({ conversationId } = await newProject(member, 'Quota'));
    h.factory.script([{ kind: 'text', text: 'answer', usage: EXPENSIVE }]);
  });
  afterAll(async () => h.close());

  it('lists only allowlisted shared models to the member', async () => {
    const models = await member.get<{ model: { id: string }; credentialModes: string[] }[]>('/api/models');
    expect(models.body.find((m) => m.model.id === gpt5)?.credentialModes).toEqual(['shared']);
    expect(models.body.some((m) => m.model.id === gpt41)).toBe(false);
  });

  it('uses the shared key until the daily quota is spent, then blocks server-side', async () => {
    const first = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'one', modelId: gpt5, credentialMode: 'shared' });
    expect(first.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    expect(h.factory.lastRequest()).toMatchObject({ apiKey: ADMIN_KEY, model: 'gpt-5' });

    const before = h.factory.requests.length;
    const second = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'two', modelId: gpt5, credentialMode: 'shared' });
    expect(second.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'error', errorCode: 'quota_exceeded' });
    expect(h.factory.requests.length).toBe(before);

    const records = await member.get<{ status: string; credentialSource: string }[]>('/api/usage/records');
    expect(records.body[0]).toMatchObject({ status: 'blocked_quota', credentialSource: 'shared' });
    const grants = await admin.get<{ id: string; spentTodayUsd: number }[]>('/api/admin/shared-grants');
    expect(grants.body.find((g) => g.id === grantId)?.spentTodayUsd).toBeGreaterThanOrEqual(1.25);
  });

  it('rejects models outside the allowlist on the shared key', async () => {
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'x', modelId: gpt41, credentialMode: 'shared' });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'error', errorCode: 'forbidden' });
  });

  it('still lets the member use their own key (explicit BYOK and auto mode)', async () => {
    await member.post('/api/keys', { providerId: await providerId(member, 'openai'), apiKey: MEMBER_KEY });
    const byok = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'mine', modelId: gpt5, credentialMode: 'byok' });
    expect(byok.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    expect(h.factory.lastRequest()?.apiKey).toBe(MEMBER_KEY);

    const auto = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'auto', modelId: gpt41 });
    expect(auto.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    expect(h.factory.lastRequest()).toMatchObject({ apiKey: MEMBER_KEY, model: 'gpt-4.1' });
  });

  it('enforces the monthly quota independently of the daily one', async () => {
    await admin.patch(`/api/admin/shared-grants/${grantId}`, { dailyLimitUsd: 1000, monthlyLimitUsd: 1 });
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'm', modelId: gpt5, credentialMode: 'shared' });
    const end = run.events.find((e) => e.type === 'message_end');
    expect(end).toMatchObject({ status: 'error', errorCode: 'quota_exceeded' });
    expect(JSON.stringify(run.events)).toContain('Monthly quota');
  });

  it('a disabled grant cannot be used', async () => {
    await admin.patch(`/api/admin/shared-grants/${grantId}`, { enabled: false, monthlyLimitUsd: 1000 });
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, { content: 'd', modelId: gpt5, credentialMode: 'shared' });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'error', errorCode: 'credential_missing' });
  });
});
