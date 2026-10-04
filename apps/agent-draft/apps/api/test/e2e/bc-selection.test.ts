import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  modelRef,
  newProject,
  providerId,
  startHarness,
  type Client,
  type Harness,
} from '../helpers/harness.js';

describe('B/C. provider and model selection', () => {
  let h: Harness;
  let admin: Client;
  let claude: string;
  let gpt5: string;
  let gemini: string;

  beforeAll(async () => {
    h = await startHarness('wf_bc');
    admin = await adminClient(h);
    await admin.post('/api/keys', {
      providerId: await providerId(admin, 'anthropic'),
      apiKey: 'sk-ant-admin-0001',
    });
    await admin.post('/api/keys', {
      providerId: await providerId(admin, 'openai'),
      apiKey: 'sk-openai-admin-0002',
    });
    await admin.post('/api/keys', {
      providerId: await providerId(admin, 'gemini'),
      apiKey: 'AIza-gemini-admin-0003',
    });
    claude = await modelRef(admin, 'anthropic', 'claude-sonnet-4-5');
    gpt5 = await modelRef(admin, 'openai', 'gpt-5');
    gemini = await modelRef(admin, 'gemini', 'gemini-2.5-pro');
  });
  afterAll(async () => h.close());

  it('B. streams the response of the selected provider/model incrementally', async () => {
    const { conversationId } = await newProject(admin, 'Streaming');
    const text = 'Streaming works: this sentence arrives in several separate chunks.';
    h.factory.script([{ kind: 'text', text }]);
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'hi',
      modelId: claude,
    });

    // The user's message is echoed first; the assistant's stream starts at message_start.
    const start = run.events.findIndex((e) => e.type === 'message_start' && e.role === 'assistant');
    expect(start).toBeGreaterThan(-1);
    const deltas = run.events.slice(start).filter((e) => e.type === 'part_delta');
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.map((d) => (d.type === 'part_delta' ? d.delta : '')).join('')).toBe(text);
    expect(run.events.some((e) => e.type === 'usage')).toBe(true);

    expect(h.factory.lastRequest()).toMatchObject({
      kind: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-admin-0001',
    });
    const msgs = await admin.get<{
      messages: { role: string; modelId: string | null; parts: { text: string | null }[] }[];
    }>(`/api/conversations/${conversationId}/messages`);
    const answer = msgs.body.messages.find((m) => m.role === 'assistant');
    expect(answer?.modelId).toBe(claude);
    expect(answer?.parts[0]?.text).toBe(text);
  });

  it('C. switching provider/model per message, per conversation and per project changes the next request', async () => {
    const { projectId, conversationId } = await newProject(admin, 'Switching');
    h.factory.script([{ kind: 'text', text: 'ok' }]);

    await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'one', modelId: claude });
    expect(h.factory.lastRequest()).toMatchObject({ kind: 'anthropic', model: 'claude-sonnet-4-5' });

    // Per message.
    await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'two', modelId: gpt5 });
    expect(h.factory.lastRequest()).toMatchObject({
      kind: 'openai',
      model: 'gpt-5',
      apiKey: 'sk-openai-admin-0002',
    });
    // The new provider receives the full conversation so far.
    expect(JSON.stringify(h.factory.lastRequest()?.messages)).toContain('one');

    // Per conversation: no per-message model → the conversation's model is used.
    expect((await admin.patch(`/api/conversations/${conversationId}`, { modelId: gemini })).status).toBe(200);
    await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'three' });
    expect(h.factory.lastRequest()).toMatchObject({
      kind: 'gemini',
      model: 'gemini-2.5-pro',
      apiKey: 'AIza-gemini-admin-0003',
    });

    // Per project default for a new conversation.
    expect((await admin.patch(`/api/projects/${projectId}`, { defaultModelId: gpt5 })).status).toBe(200);
    const conv2 = await admin.post<{ id: string }>(`/api/projects/${projectId}/conversations`, {});
    await admin.sse(`/api/conversations/${conv2.body.id}/messages`, { content: 'four' });
    expect(h.factory.lastRequest()).toMatchObject({ kind: 'openai', model: 'gpt-5' });

    // User default applies when nothing else is set.
    await admin.patch(`/api/projects/${projectId}`, { defaultModelId: null });
    await admin.put('/api/me/defaults', { defaultModelId: gemini, defaultCredentialMode: null });
    const conv3 = await admin.post<{ id: string }>(`/api/projects/${projectId}/conversations`, {});
    await admin.sse(`/api/conversations/${conv3.body.id}/messages`, { content: 'five' });
    expect(h.factory.lastRequest()).toMatchObject({ kind: 'gemini' });
  });
});
