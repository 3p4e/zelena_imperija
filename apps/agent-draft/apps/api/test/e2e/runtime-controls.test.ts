import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, modelRef, newProject, providerId, startHarness, type Client, type Harness } from '../helpers/harness.js';

interface MsgList {
  messages: { role: string; status: string; parts: { kind: string; text: string | null }[] }[];
  running: boolean;
}

describe('agent runtime controls: stop, regenerate, retry, provider failures', () => {
  let h: Harness;
  let admin: Client;
  let claude: string;
  let anthropicId: string;

  beforeAll(async () => {
    h = await startHarness('wf_rt');
    admin = await adminClient(h);
    anthropicId = await providerId(admin, 'anthropic');
    await admin.post('/api/keys', { providerId: anthropicId, apiKey: 'sk-ant-runtime-0001' });
    claude = await modelRef(admin, 'anthropic', 'claude-sonnet-4-5');
  });
  afterAll(async () => h.close());

  it('stop ends a streaming answer and keeps the partial text', async () => {
    const { conversationId } = await newProject(admin, 'Stop');
    h.factory.chunkDelayMs = 40;
    h.factory.script([{ kind: 'text', text: 'word '.repeat(200) }]);
    const pending = admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'long answer', modelId: claude });
    await new Promise((r) => setTimeout(r, 400));
    expect((await admin.get<MsgList>(`/api/conversations/${conversationId}/messages`)).body.running).toBe(true);
    // A second message while running is refused.
    expect((await admin.post(`/api/conversations/${conversationId}/messages`, { content: 'again' })).status).toBe(409);
    expect((await admin.post<{ stopped: boolean }>(`/api/conversations/${conversationId}/stop`)).body.stopped).toBe(true);
    const run = await pending;
    h.factory.chunkDelayMs = 2;
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'stopped' });
    expect(run.events.at(-1)).toEqual({ type: 'conversation_status', status: 'stopped' });
    const list = await admin.get<MsgList>(`/api/conversations/${conversationId}/messages`);
    const answer = list.body.messages.find((m) => m.role === 'assistant');
    expect(answer?.status).toBe('stopped');
    const partial = answer?.parts[0]?.text ?? '';
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(1000);
  });

  it('regenerate replaces the last answer and the model does not see the old one', async () => {
    const { conversationId } = await newProject(admin, 'Regenerate');
    h.factory.script([{ kind: 'text', text: 'FIRST ANSWER' }]);
    await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'question', modelId: claude });
    h.factory.script([{ kind: 'text', text: 'SECOND ANSWER' }]);
    const run = await admin.sse(`/api/conversations/${conversationId}/regenerate`, { modelId: claude });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    expect(JSON.stringify(h.factory.lastRequest()?.messages)).not.toContain('FIRST ANSWER');
    const list = await admin.get<MsgList>(`/api/conversations/${conversationId}/messages`);
    expect(list.body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(list.body.messages[1]?.parts[0]?.text).toBe('SECOND ANSWER');
  });

  it('retries transient provider failures automatically', async () => {
    const { conversationId } = await newProject(admin, 'Transient');
    h.factory.script([
      { kind: 'error', code: 'unavailable', message: 'overloaded', status: 529 },
      { kind: 'text', text: 'recovered' },
    ]);
    const before = h.factory.requests.length;
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'q', modelId: claude });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    expect(h.factory.requests.length - before).toBe(2);
  });

  it('surfaces non-retryable failures, then retry succeeds once fixed', async () => {
    const { conversationId } = await newProject(admin, 'Retry');
    h.factory.script([{ kind: 'error', code: 'bad_request', message: 'context too long', status: 400 }]);
    const failed = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'q', modelId: claude });
    const end = failed.events.find((e) => e.type === 'message_end');
    expect(end).toMatchObject({ status: 'error', errorCode: 'provider_bad_request' });
    expect(JSON.stringify(failed.events)).not.toMatch(/at \w+ \(|node_modules|stack/i);
    const usage = await admin.get<{ status: string }[]>('/api/usage/records');
    expect(usage.body[0]?.status).toBe('error');

    h.factory.script([{ kind: 'text', text: 'works now' }]);
    const retried = await admin.sse(`/api/conversations/${conversationId}/regenerate`, {});
    expect(retried.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    const list = await admin.get<MsgList>(`/api/conversations/${conversationId}/messages`);
    expect(list.body.messages.map((m) => m.status)).toEqual(['complete', 'complete']);
  });

  it('reports a clear error when no model is configured anywhere', async () => {
    await admin.put('/api/admin/settings', { defaultModelId: null });
    const { conversationId } = await newProject(admin, 'No model');
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'q' });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'error', errorCode: 'model_unavailable' });
  });
});
