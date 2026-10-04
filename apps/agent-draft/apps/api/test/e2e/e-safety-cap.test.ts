import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, modelRef, newProject, providerId, startHarness, type Client, type Harness } from '../helpers/harness.js';

// claude-sonnet-4-5 is seeded at $3 / Mtok input: one million input tokens ≈ $3 per call.
const EXPENSIVE = { inputTokens: 1_000_000, outputTokens: 10 };

describe('E. admin safety cap', () => {
  let h: Harness;
  let admin: Client;
  let claude: string;

  beforeAll(async () => {
    h = await startHarness('wf_e');
    admin = await adminClient(h);
    await admin.post('/api/keys', { providerId: await providerId(admin, 'anthropic'), apiKey: 'sk-ant-admin-cap' });
    claude = await modelRef(admin, 'anthropic', 'claude-sonnet-4-5');
  });
  afterAll(async () => h.close());

  it('with the cap disabled the admin is never blocked', async () => {
    await admin.put('/api/admin/settings', { adminSafetyCapEnabled: false, adminCapPerDayUsd: 0.01, adminCapPerTaskUsd: 0.01 });
    const { conversationId } = await newProject(admin, 'Uncapped');
    h.factory.script([{ kind: 'text', text: 'expensive', usage: EXPENSIVE }]);
    for (let i = 0; i < 4; i++) {
      const run = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: `call ${i}`, modelId: claude });
      expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    }
    const usage = await admin.get<{ estimatedCostUsd: number }>('/api/usage/summary');
    expect(usage.body.estimatedCostUsd).toBeGreaterThan(10);
  });

  it('with the daily cap enabled, the server blocks before calling the provider', async () => {
    // Today's spend is already > $12 from the previous test.
    await admin.put('/api/admin/settings', { adminSafetyCapEnabled: true, adminCapPerDayUsd: 5, adminCapPerTaskUsd: null });
    const { conversationId } = await newProject(admin, 'Capped');
    const before = h.factory.requests.length;
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'blocked?', modelId: claude });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'error', errorCode: 'safety_cap_reached' });
    expect(h.factory.requests.length).toBe(before);
    const records = await admin.get<{ status: string }[]>('/api/usage/records');
    expect(records.body[0]?.status).toBe('blocked_cap');

    // Raising the cap is enough to continue.
    await admin.put('/api/admin/settings', { adminCapPerDayUsd: 1000 });
    const again = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'now?', modelId: claude });
    expect(again.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
  });

  it('the per-task cap stops a multi-step run between steps', async () => {
    await admin.put('/api/admin/settings', { adminSafetyCapEnabled: true, adminCapPerDayUsd: null, adminCapPerTaskUsd: 1 });
    const { conversationId } = await newProject(admin, 'Per task');
    h.factory.script([
      { kind: 'tool_call', name: 'fs_list', arguments: {}, usage: EXPENSIVE },
      { kind: 'text', text: 'never reached' },
    ]);
    const before = h.factory.requests.length;
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'multi-step', modelId: claude });
    expect(h.factory.requests.length - before).toBe(1);
    const errorEnd = run.events.filter((e) => e.type === 'message_end').at(-1);
    expect(errorEnd).toMatchObject({ status: 'error', errorCode: 'safety_cap_reached' });
    expect(JSON.stringify(run.events)).toContain('per-task safety cap');
  });
});
